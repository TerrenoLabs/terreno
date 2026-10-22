import type {MergeableStore} from "tinybase";
import type {AnyPersister} from "tinybase/persisters";

import type {KeyProvider} from "../crypto/types";
import type {idbGet, idbSet} from "../storage/idb";

/**
 * Binds a TinyBase persister to a specific store + logical database name. The
 * returned persister must support MergeableStore content (TinyBase
 * `Persists.MergeableStoreOnly` or `Persists.StoreOrMergeableStore`) so CRDT
 * metadata survives the round trip.
 *
 * `hooks` carries the client's E3 failure-surfacing callbacks
 * (`onDecryptFailure`/`onLoadFailure`/`onSaveFailure`) — always passed
 * through regardless of whether the default or a custom factory is in use, so
 * a host app supplying its own `persisterFactory` (e.g. a different storage
 * backend) can still opt into the same SyncStatus surfacing by wiring these
 * into its own persister. Optional to consume; a factory that ignores
 * `hooks` simply forgoes that surfacing (matches pre-E3 behavior).
 */
export type PersisterFactory = ({
  store,
  databaseName,
  hooks,
}: {
  store: MergeableStore;
  databaseName: string;
  hooks?: {
    onDecryptFailure?: () => void;
    onLoadFailure?: () => void;
    onSaveFailure?: (error: unknown) => void;
  };
}) => SyncPersister;

/**
 * Persister capabilities used by the sync client beyond TinyBase's standard
 * lifecycle. Web persistence exposes `flush` so durability-sensitive state
 * transitions can bypass its normal trailing debounce.
 */
export type SyncPersister = AnyPersister & {
  flush?: () => Promise<void>;
  /**
   * Resolve anything a save needs from the network (the web persister's
   * encryption key) up front, so a stop-time flush after the session has
   * ended can still write.
   */
  prepare?: () => Promise<void>;
};

/**
 * Options accepted by `createDefaultPersisterFactory` on every platform. Each
 * platform variant consumes the subset it needs and ignores the rest, keeping
 * the call site platform-agnostic.
 */
export interface DefaultPersisterFactoryConfig {
  /**
   * Encryption key provider (web only; encryption is default-on there).
   * Defaults to a device-local random key when omitted.
   */
  keyProvider?: KeyProvider;
  /** User id the encryption key is derived/scoped for (web only). */
  userId?: string;
  /** Invoked when persisted data cannot be decrypted (web only). */
  onDecryptFailure?: () => void;
  /**
   * E3(a): invoked when the underlying storage READ itself fails (distinct
   * from "no data" and from a decrypt/parse failure) — a signal that the
   * persisted blob might still be intact and must not be autosaved over
   * (web only).
   */
  onLoadFailure?: () => void;
  /**
   * E3(a): invoked when a WRITE to storage ultimately fails (e.g. a
   * quota-exceeded error) — TinyBase's autosave scheduler otherwise swallows
   * this silently (web only).
   */
  onSaveFailure?: (error: unknown) => void;
  /** Trailing save debounce in ms; 0 disables debouncing (web only). */
  saveDebounceMs?: number;
  /** SQLite table name holding the JSON-serialized store (native only). */
  storeTableName?: string;
  /** Test-only override for the IndexedDB read (web only; default: the real `idbGet`). */
  idbGetImpl?: typeof idbGet;
  /** Test-only override for the IndexedDB write (web only; default: the real `idbSet`). */
  idbSetImpl?: typeof idbSet;
}
