/**
 * Snapshot bootstrap: page `GET /sync/snapshot` per STREAM into the local store until
 * the server reports no more pages.
 *
 * ## Cursor semantics (C2 — per-stream cursors)
 *
 * Bootstrap pages one stream per request (the server resolves the stream's scope from
 * the stream key and pages by `_syncSeq`). Progress is kept in `_cursors` keyed by the
 * REAL stream key (the same key deltas advance) — the old `snapshot:{collection}`
 * pseudo-cursors are gone. Snapshot entities are applied with the same protections as
 * `applyDelta`: entities protected by a pending outbox mutation are never overwritten,
 * and stale seqs are skipped.
 *
 * Two progress cells, not one: `snapshotSeq` (how far this stream has been PAGED) is
 * tracked separately from `seq` (the highest applied seq, which deltas also advance).
 * An unfinished bootstrap resumes from `snapshotSeq`, because a live delta at the stream
 * head can overtake the applied-seq cursor mid-bootstrap — resuming there would leave
 * every unpaged seq below it permanently unreachable. Once a pass reaches the head, the
 * stream is marked `bootstrapped` and catch-up resumes from `seq` (deltas carry their own
 * data, so nothing below it needs paging).
 *
 * ## Frontier & retention (C1/C7)
 *
 * The client never advances a stream's cursor past the server-reported `frontierSeq`.
 * If the stored cursor is below the response's `oldestRetainedSeq`, compacted tombstones
 * may have been missed → the stream is purged and re-bootstrapped from 0 (a sanctioned
 * retention-gap wipe, distinct from an auth wipe — INV-2).
 *
 * ## Legacy stratum (C3)
 *
 * While the server returns a `legacyCursor`, bootstrap echoes it back verbatim to drain
 * the seq-0 (unstamped) stratum by `_id` before proceeding to seq paging.
 */

import type {SyncStore} from "../storage/store";
import type {
  SyncSnapshotBatchRequest,
  SyncSnapshotBatchResponse,
  SyncSnapshotEntity,
  SyncSnapshotResponse,
} from "../types";
import {
  getCursor,
  getSnapshotCursor,
  isStreamBootstrapped,
  markStreamBootstrapped,
  setCursor,
  setSnapshotCursor,
} from "./cursor";
import type {HttpChannel} from "./httpChannel";

export interface BootstrapProgress {
  /** The stream just paged. */
  stream: string;
  collection: string;
  /** Entities in the page just fetched. */
  fetched: number;
  /** Entities from that page actually written locally (rest were protected/stale). */
  applied: number;
  /** The stream's cursor after this page. */
  cursor: number;
  /** True when more pages remain for this stream. */
  hasMore: boolean;
}

/**
 * Apply one snapshot entity with `applyDelta`-equivalent protections. Returns true when
 * the entity was written locally. Records the stream so leave-purge is O(stream).
 */
const applySnapshotEntity = ({
  store,
  collection,
  stream,
  entity,
}: {
  store: SyncStore;
  collection: string;
  stream: string;
  entity: SyncSnapshotEntity;
}): boolean => {
  const existing = store.getEntity({collection, id: entity.id});
  // Seq-0 legacy entities always apply on first sight (existing seq is also 0); a stamped
  // entity at or below the applied seq is a stale/duplicate page and is skipped.
  if (existing && entity.seq > 0 && entity.seq <= existing.seq) {
    return false;
  }
  if (existing?.pendingMutationId) {
    store.markNeedsRepair({
      collection,
      entityId: entity.id,
      missedSeq: entity.seq,
      stream,
    });
    // Optimistic local state is protected until its mutation resolves.
    return false;
  }
  store.upsertEntity({
    collection,
    data: entity.data,
    deleted: entity.deleted,
    id: entity.id,
    pendingMutationId: "",
    seq: entity.seq,
    stream,
  });
  store.clearNeedsRepair({collection, entityId: entity.id});
  return true;
};

/** Entities written per store transaction before yielding to the host event loop. */
const DEFAULT_APPLY_CHUNK_SIZE = 500;

/** Most streams named in one `POST /sync/snapshot/batch` request (server cap). */
const MAX_SNAPSHOT_BATCH_STREAMS = 500;

const defaultYieldToHost = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** Per-stream paging state shared by single-stream and batch bootstrap. */
interface StreamPagingState {
  stream: string;
  collection: string;
  cursor: number;
  legacyCursor?: string;
  hasMore: boolean;
  retentionChecked: boolean;
  /** True when the server itself reported the stream head was reached. */
  reachedHead: boolean;
}

/**
 * What one fetched page means for the local store. Planning only touches paging state,
 * so the next request can go out before this page is written.
 */
interface PagePlan {
  stream: string;
  collection: string;
  /** C7: purge the stream (and drop this page) before anything else is written. */
  purge: boolean;
  entities: SyncSnapshotEntity[];
  /** Seq both cursors advance to once the entities land. */
  advanceTo?: number;
  /** True when this is the stream's last page and the server reported its head. */
  completesStream: boolean;
  progress: Omit<BootstrapProgress, "applied">;
}

const initialPagingState = ({
  store,
  stream,
  collection,
}: {
  store: SyncStore;
  stream: string;
  collection: string;
}): StreamPagingState => {
  // Until a snapshot pass has reached the stream head, resume from snapshot progress
  // (`snapshotSeq`) rather than the applied-seq cursor: a live delta can push the latter
  // to the head mid-bootstrap, and resuming there would skip every unpaged seq below it
  // forever. Once bootstrapped, the applied-seq cursor IS the correct catch-up point.
  const bootstrapped = isStreamBootstrapped({store, stream});
  return {
    collection,
    cursor: bootstrapped ? getCursor({store, stream}) : getSnapshotCursor({store, stream}),
    hasMore: true,
    legacyCursor: undefined,
    reachedHead: false,
    retentionChecked: false,
    stream,
  };
};

/**
 * Advance `state` past one fetched page (C7 retention check, C3 legacy stratum, C1
 * frontier clamp) and describe the writes that page needs.
 */
const planSnapshotPage = ({
  state,
  page,
}: {
  state: StreamPagingState;
  page: SyncSnapshotResponse;
}): PagePlan => {
  const {collection, stream} = state;
  const base = {collection, completesStream: false, entities: page.entities, stream};
  // C7: a stored cursor below the retained floor means compacted tombstones were
  // missed — purge and re-bootstrap this stream from 0 exactly once.
  if (!state.retentionChecked) {
    state.retentionChecked = true;
    if (state.cursor > 0 && state.cursor < page.oldestRetainedSeq) {
      state.cursor = 0;
      state.legacyCursor = undefined;
      return {
        ...base,
        entities: [],
        progress: {collection, cursor: 0, fetched: 0, hasMore: true, stream},
        purge: true,
      };
    }
  }

  if (page.legacyCursor !== undefined) {
    // C3: still draining the seq-0 stratum — echo the token, cursor stays 0.
    const advanced = page.legacyCursor !== state.legacyCursor;
    state.legacyCursor = page.legacyCursor;
    state.hasMore = advanced;
    return {
      ...base,
      progress: {
        collection,
        cursor: 0,
        fetched: page.entities.length,
        hasMore: state.hasMore,
        stream,
      },
      purge: false,
    };
  }
  // Legacy stratum done (or never present) — proceed by seq.
  state.legacyCursor = undefined;

  // C1: never advance past the stable frontier; the server already clamped page.cursor.
  const clampedCursor = Math.min(page.cursor, page.frontierSeq);
  const madeProgress = clampedCursor > state.cursor;
  // Guard against a server reporting hasMore without advancing (would loop forever).
  state.hasMore = page.hasMore && madeProgress;
  // Only the server saying "no more pages" proves the head was reached; exiting via the
  // guard above means the pass is incomplete and must resume from snapshot progress.
  state.reachedHead = !page.hasMore;
  state.cursor = Math.max(state.cursor, clampedCursor);
  return {
    ...base,
    advanceTo: madeProgress ? clampedCursor : undefined,
    completesStream: !state.hasMore && state.reachedHead,
    progress: {
      collection,
      cursor: state.cursor,
      fetched: page.entities.length,
      hasMore: state.hasMore,
      stream,
    },
    purge: false,
  };
};

/**
 * Write a planned page. Entities land in transactions of `chunkSize` with a yield to the
 * host between them, so a large page never blocks the UI thread in one piece. The cursor
 * advance rides in the last chunk's transaction: if the app dies mid-page, the page is
 * re-fetched, and the seq guards make re-applying it a no-op.
 */
const writePagePlan = async ({
  store,
  plan,
  chunkSize,
  yieldToHost,
  onProgress,
  now,
}: {
  store: SyncStore;
  plan: PagePlan;
  chunkSize: number;
  yieldToHost: () => Promise<void>;
  onProgress?: (progress: BootstrapProgress) => void;
  now?: () => string;
}): Promise<void> => {
  const {collection, stream, entities, advanceTo} = plan;
  if (plan.purge) {
    store.purgeStream({stream});
    store.addKnownStream({collection, stream});
    return;
  }
  let applied = 0;
  let offset = 0;
  do {
    const chunk = entities.slice(offset, offset + chunkSize);
    offset += chunkSize;
    const isLastChunk = offset >= entities.length;
    // E4: one transaction per chunk, so TinyBase fires listeners (and the autosave
    // persister's did-finish-transaction write) once per chunk rather than once per row.
    applied += store.raw.transaction(() => {
      let count = 0;
      for (const entity of chunk) {
        if (applySnapshotEntity({collection, entity, store, stream})) {
          count += 1;
        }
      }
      if (isLastChunk && advanceTo !== undefined) {
        setCursor({now, seq: advanceTo, store, stream});
        setSnapshotCursor({seq: advanceTo, store, stream});
      }
      return count;
    });
    if (!isLastChunk) {
      await yieldToHost();
    }
  } while (offset < entities.length);
  if (plan.completesStream) {
    markStreamBootstrapped({store, stream});
  }
  onProgress?.({...plan.progress, applied});
};

/**
 * Page a single stream from its current cursor to the server's head. Handles the C3
 * legacy stratum (echoing `legacyCursor`), C1 frontier clamping, and C7 retention-gap
 * re-bootstrap.
 */
export const bootstrapStream = async ({
  store,
  channel,
  stream,
  collection,
  limit,
  onProgress,
  now,
  applyChunkSize = DEFAULT_APPLY_CHUNK_SIZE,
  yieldToHost = defaultYieldToHost,
}: {
  store: SyncStore;
  channel: Pick<HttpChannel, "fetchSnapshotPage">;
  stream: string;
  collection: string;
  limit?: number;
  onProgress?: (progress: BootstrapProgress) => void;
  now?: () => string;
  applyChunkSize?: number;
  yieldToHost?: () => Promise<void>;
}): Promise<void> => {
  const state = initialPagingState({collection, store, stream});
  while (state.hasMore) {
    const page = await channel.fetchSnapshotPage({
      cursor: state.cursor,
      legacyCursor: state.legacyCursor,
      limit,
      stream,
    });
    const plan = planSnapshotPage({page, state});
    await writePagePlan({chunkSize: applyChunkSize, now, onProgress, plan, store, yieldToHost});
  }
};

/** Fetches one page for each requested stream in a single round trip. */
type FetchSnapshotBatch = (request: SyncSnapshotBatchRequest) => Promise<SyncSnapshotBatchResponse>;

/**
 * Page many streams through `POST /sync/snapshot/batch`: one round trip per round
 * instead of one per stream per page. `limit` is the server's entity budget for the
 * whole response, shared across the requested streams. Rounds are pipelined: the next
 * request leaves as soon as a response arrives (its cursors come from the response,
 * not the store), and the current round is written while it is in flight.
 *
 * Returns false when `isSuperseded` fired and the pass stopped early.
 */
export const bootstrapStreamsBatch = async ({
  store,
  fetchSnapshotBatch,
  streams,
  limit,
  onProgress,
  now,
  isSuperseded,
  applyChunkSize = DEFAULT_APPLY_CHUNK_SIZE,
  yieldToHost = defaultYieldToHost,
}: {
  store: SyncStore;
  fetchSnapshotBatch: FetchSnapshotBatch;
  streams: {stream: string; collection: string}[];
  limit?: number;
  onProgress?: (progress: BootstrapProgress) => void;
  now?: () => string;
  /** Checked after every response and every written page; true stops the pass. */
  isSuperseded?: () => boolean;
  applyChunkSize?: number;
  yieldToHost?: () => Promise<void>;
}): Promise<boolean> => {
  const states = new Map<string, StreamPagingState>();
  for (const {stream, collection} of streams) {
    states.set(stream, initialPagingState({collection, store, stream}));
  }

  const requestRound = (): Promise<SyncSnapshotBatchResponse> | undefined => {
    const pending = [...states.values()]
      .filter((state) => state.hasMore)
      .slice(0, MAX_SNAPSHOT_BATCH_STREAMS);
    if (pending.length === 0) {
      return undefined;
    }
    return fetchSnapshotBatch({
      limit,
      streams: pending.map((state) => ({
        cursor: state.cursor,
        legacyCursor: state.legacyCursor,
        stream: state.stream,
      })),
    }).then((response) => {
      const answered = new Set(response.pages.map((page) => page.stream));
      for (const state of pending) {
        if (!answered.has(state.stream)) {
          throw new Error(`Snapshot batch response is missing stream ${state.stream}`);
        }
      }
      return response;
    });
  };

  let inFlight = requestRound();
  try {
    while (inFlight !== undefined) {
      const {pages} = await inFlight;
      inFlight = undefined;
      if (isSuperseded?.()) {
        return false;
      }
      const plans: PagePlan[] = [];
      for (const page of pages) {
        const state = states.get(page.stream);
        if (state) {
          plans.push(planSnapshotPage({page, state}));
        }
      }
      inFlight = requestRound();
      for (const plan of plans) {
        await writePagePlan({
          chunkSize: applyChunkSize,
          now,
          onProgress,
          plan,
          store,
          yieldToHost,
        });
        if (isSuperseded?.()) {
          return false;
        }
      }
    }
    return true;
  } finally {
    // An early exit abandons the prefetched round; never leave its rejection unhandled.
    inFlight?.catch(() => {});
  }
};
