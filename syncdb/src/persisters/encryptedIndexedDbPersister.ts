import type {ContentHashes, MergeableContent, MergeableStore} from "tinybase";
import {createCustomPersister, type Persister, Persists} from "tinybase/persisters";

import type {PayloadCodec} from "../crypto/types";
import {idbGet, idbSet} from "../storage/idb";
import type {SyncPersister} from "./types";

/** Object-store record key holding the single encrypted blob. */
const RECORD_KEY = "content";

/** Default trailing debounce applied to saves (autosave can fire per transaction). */
const DEFAULT_SAVE_DEBOUNCE_MS = 500;

const sameHashes = (a: ContentHashes, b: ContentHashes | undefined): boolean =>
  b !== undefined && a[0] === b[0] && a[1] === b[1];

interface PendingSave {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Web persister storing the whole MergeableStore as ONE encrypted binary blob
 * in IndexedDB (database per `databaseName`, single object store, single
 * record). The plaintext JSON only ever exists in memory: serialize → encode
 * (AES-GCM) → put blob. Corrupt or undecryptable data is treated as a fresh
 * store — `onDecryptFailure` fires so the caller can wipe and re-bootstrap.
 *
 * A READ error from IndexedDB itself (as opposed to "no record yet") is a
 * different failure mode (E3a): the blob may well still be intact, so it must
 * NOT be treated as "fresh store" (which would let a subsequent autosave
 * clobber it with empty content). `onLoadFailure` fires in that case instead
 * of `onDecryptFailure`, and the underlying read error is re-thrown so
 * TinyBase's own `getPersisted` error handling leaves the in-memory store
 * exactly as it was (never calls `setContentOrChanges`) — callers key off
 * `onLoadFailure` to additionally skip `startAutoSave()` for this session.
 *
 * Saves are debounced with a trailing edge (default 500ms) since TinyBase's
 * autosave fires on every transaction: each write waits out the debounce
 * window, and follow-up saves whose content hashes match the last written
 * snapshot are skipped, coalescing a burst of transactions into a single
 * encode + IndexedDB put. The store is serialized only when a write actually
 * happens, never per transaction.
 */
export const createEncryptedIndexedDbPersister = ({
  store,
  databaseName,
  codec,
  onDecryptFailure,
  onLoadFailure,
  onSaveFailure,
  saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
  idbGetImpl = idbGet,
  idbSetImpl = idbSet,
}: {
  store: MergeableStore;
  databaseName: string;
  codec: PayloadCodec;
  onDecryptFailure?: () => void;
  onLoadFailure?: () => void;
  /**
   * E3(a): invoked whenever a write to IndexedDB ultimately fails (e.g. a
   * quota-exceeded `DOMException`) — TinyBase's own autosave scheduler
   * otherwise swallows `setPersisted` errors silently via its internal
   * `onIgnoredError`, so without this hook a failing save would be invisible.
   */
  onSaveFailure?: (error: unknown) => void;
  saveDebounceMs?: number;
  /** Test-only override for the IndexedDB read (default: the real `idbGet`). */
  idbGetImpl?: typeof idbGet;
  /** Test-only override for the IndexedDB write (default: the real `idbSet`). */
  idbSetImpl?: typeof idbSet;
}): Persister<Persists.MergeableStoreOnly> & SyncPersister => {
  // Content hashes of the last snapshot that reached IndexedDB. TinyBase keeps
  // them incrementally, so comparing is O(1) where re-serializing is O(store).
  let lastWrittenHashes: ContentHashes | undefined;
  let pendingSave: PendingSave | undefined;
  // E3(e): the debounce timer scheduling `flushPendingSave` — tracked so
  // `destroy()` can cancel it. Without this, a pending debounced save would
  // still fire (and write) after destroy(), which is exactly the kind of
  // "wrote something after we thought we were done" bug destroy() must
  // prevent (e.g. a wipe immediately followed by destroy()).
  let pendingSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  // Serializes writes so a slow encode/put can never land after (and clobber)
  // a newer snapshot's write.
  let writeChain: Promise<void> = Promise.resolve();

  const writeJson = (json: string, hashes: ContentHashes): Promise<void> => {
    const write = writeChain.then(async () => {
      // E3(e): destroy() may have run while this write was already chained
      // behind an earlier one — never let it land after destroy() completes.
      if (destroyed) {
        return;
      }
      const payload = await codec.encode(json);
      await idbSetImpl({databaseName, key: RECORD_KEY, value: payload});
      lastWrittenHashes = hashes;
    });
    // Keep the chain alive after a failed write; the failure still propagates
    // to the caller through `write`.
    writeChain = write.catch(() => {});
    return write;
  };

  const flushPendingSave = async (): Promise<void> => {
    const pending = pendingSave;
    pendingSave = undefined;
    if (!pending) {
      return;
    }
    try {
      // Trailing edge: snapshot the store at flush time so a burst of
      // transactions during the debounce window lands as one fresh write.
      const hashes = store.getMergeableContentHashes();
      await writeJson(JSON.stringify(store.getMergeableContent()), hashes);
      pending.resolve();
    } catch (error) {
      pending.reject(error);
    }
  };

  const flush = async (): Promise<void> => {
    if (pendingSaveTimer !== undefined) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = undefined;
    }
    const pending = pendingSave;
    if (pending) {
      await flushPendingSave();
      await pending.promise;
      return;
    }

    const hashes = store.getMergeableContentHashes();
    if (sameHashes(hashes, lastWrittenHashes)) {
      return;
    }
    try {
      await writeJson(JSON.stringify(store.getMergeableContent()), hashes);
    } catch (error) {
      onSaveFailure?.(error);
      throw error;
    }
  };

  const getPersisted = async (): Promise<MergeableContent | undefined> => {
    let payload: unknown;
    try {
      payload = await idbGetImpl<unknown>({databaseName, key: RECORD_KEY});
    } catch (error) {
      // E3(a): the READ itself failed (IndexedDB unavailable/blocked/thrown) —
      // this is NOT "no data" (undefined) and must not be treated as a fresh
      // store: onDecryptFailure (whose default wipes and re-bootstraps) would
      // be actively harmful here since the persisted blob may still be
      // perfectly intact. Signal the distinct failure and re-throw so
      // TinyBase's own error handling leaves the in-memory store untouched
      // rather than defaulting it to empty.
      onLoadFailure?.();
      throw error;
    }
    if (payload === undefined) {
      return undefined;
    }
    try {
      if (!(payload instanceof Uint8Array)) {
        throw new Error("Persisted record is not a binary payload");
      }
      return JSON.parse(await codec.decode(payload)) as MergeableContent;
    } catch (_error) {
      onDecryptFailure?.();
      return undefined;
    }
  };

  const setPersisted = async (getContent: () => MergeableContent): Promise<void> => {
    if (saveDebounceMs <= 0) {
      try {
        await writeJson(JSON.stringify(getContent()), store.getMergeableContentHashes());
      } catch (error) {
        onSaveFailure?.(error);
        throw error;
      }
      return;
    }
    // TinyBase queues one setPersisted per transaction and runs them one at a
    // time, so a burst of N transactions arrives here N times, mostly after the
    // write that already captured them. Skipping saves whose content already
    // matches the last written snapshot is what coalesces the burst into one write.
    if (!pendingSave && sameHashes(store.getMergeableContentHashes(), lastWrittenHashes)) {
      return;
    }
    if (!pendingSave) {
      let resolvePending!: () => void;
      let rejectPending!: (error: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolvePending = res;
        rejectPending = rej;
      });
      pendingSave = {promise, reject: rejectPending, resolve: resolvePending};
      pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = undefined;
        void flushPendingSave();
      }, saveDebounceMs);
    }
    try {
      await pendingSave.promise;
    } catch (error) {
      onSaveFailure?.(error);
      throw error;
    }
  };

  const persister = createCustomPersister<number, Persists.MergeableStoreOnly>(
    store,
    getPersisted,
    setPersisted,
    // Nothing mutates the blob outside this persister, so no change listener;
    // a token handle keeps the add/del listener lifecycle symmetric.
    (): number => 1,
    (_listenerHandle: number): void => {},
    undefined,
    Persists.MergeableStoreOnly
  );

  // E3(e): wrap destroy() to cancel the debounce timer and drop (without
  // writing) any pending save — TinyBase's own destroy()/stopAutoPersisting()
  // has no idea this persister keeps its own setTimeout-based debounce state,
  // so without this override a pending write fires (and lands in IndexedDB)
  // even after the caller believes destroy() fully tore everything down.
  const originalDestroy = persister.destroy.bind(persister);
  return {
    ...persister,
    destroy: (): ReturnType<typeof originalDestroy> => {
      destroyed = true;
      if (pendingSaveTimer !== undefined) {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = undefined;
      }
      // A pending save's awaiters (if any) must still settle — resolve
      // rather than reject, since "destroyed before its debounce elapsed" is
      // an expected lifecycle event, not a failure the caller needs to
      // handle specially.
      pendingSave?.resolve();
      pendingSave = undefined;
      return originalDestroy();
    },
    flush,
    prepare: async (): Promise<void> => {
      await codec.prepare?.();
    },
  };
};
