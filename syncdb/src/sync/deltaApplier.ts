import type {SyncStore} from "../storage/store";
import type {SyncDelta} from "../types";
import {getCursor, setCursor} from "./cursor";

export interface ApplyDeltaResult {
  /** True when the delta changed local entity state (false = idempotent skip). */
  applied: boolean;
  /**
   * True when the delta's seq jumped past cursor + 1 (measured BEFORE
   * applying). A reconcile hint, not an error: permission-filtered deltas
   * legitimately skip seqs, so downstream rate-limits the reconcile.
   */
  seqJump: boolean;
}

/**
 * Apply a server delta to the local store, idempotently:
 *
 * - a delta below the entity's applied seq is skipped (out-of-order delivery),
 *   and so is one at that seq once the row came from a stream (duplicate);
 *   a row whose seq was stamped by its own ACK takes the equal-seq delta;
 * - an entity with a pending outbox mutation is never overwritten — its
 *   optimistic state is protected until conflict resolution decides;
 * - create/update writes data + seq; tombstones set `deleted: true` (keeping
 *   the last known data for conflict UIs);
 * - `{collection}|admin` window streams skip inserts for unknown ids (no surprise
 *   rows); Refresh is a REST re-query plus `hydrateWindow`, not a snapshot;
 * - the cursor for `delta.stream` advances in every case (including skips), so
 *   a skipped delta is never re-fetched on catch-up.
 */
export const applyDelta = ({
  store,
  delta,
  now,
}: {
  store: SyncStore;
  delta: SyncDelta;
  now?: () => string;
}): ApplyDeltaResult =>
  // E4: one transaction per delta — the entity upsert and cursor advance land
  // as a single store commit (one listener notification, one autosave
  // attempt) instead of two, and the two writes can never be observed
  // half-applied by a listener firing between them.
  store.raw.transaction(() => {
    // C1: never advance the cursor past the stream's stable frontier. A delta can
    // arrive for seq N while N-1's claim is still uncommitted (out-of-commit-order);
    // clamping to min(seq, frontierSeq) means the cursor never skips the still-pending
    // hole. Older servers omit frontierSeq — treat it as the delta's own seq (no clamp).
    const frontier = typeof delta.frontierSeq === "number" ? delta.frontierSeq : delta.seq;
    const cursorTarget = Math.min(delta.seq, frontier);
    const seqJump = delta.seq > getCursor({store, stream: delta.stream}) + 1;
    const advanceCursor = (): void => {
      setCursor({now, seq: cursorTarget, store, stream: delta.stream});
    };

    const existing = store.getEntity({collection: delta.collection, id: delta.id});
    // An equal-seq delta is a duplicate only for a row that already came from a stream.
    // A row with no stream got its seq from its own mutation's ACK (releaseEntity), and
    // the delta at that seq is the server's canonical doc for it. Skipping it would leave
    // the row without server-added fields such as `_id`, and the cursor advance below
    // means it is never fetched again.
    if (
      existing &&
      (delta.seq < existing.seq || (delta.seq === existing.seq && Boolean(existing.stream)))
    ) {
      advanceCursor();
      return {applied: false, seqJump};
    }
    if (existing?.pendingMutationId) {
      store.markNeedsRepair({
        collection: delta.collection,
        entityId: delta.id,
        missedSeq: delta.seq,
        stream: delta.stream,
      });
      advanceCursor();
      return {applied: false, seqJump};
    }

    // Admin window (`{collection}|admin`): apply update/delete only for ids already
    // in the local window. Unknown ids wait for REST membership + hydrateWindow
    // (Refresh / load more). Cursor still advances so live seq is not replayed.
    if (!existing && delta.stream.endsWith("|admin")) {
      advanceCursor();
      return {applied: false, seqJump};
    }

    const deleted = delta.deleted === true || delta.method === "delete";
    store.upsertEntity({
      collection: delta.collection,
      // Tombstone deltas omit data; keep the last known payload for conflict UIs.
      data: delta.data !== undefined ? delta.data : (existing?.data ?? null),
      deleted,
      id: delta.id,
      pendingMutationId: "",
      seq: delta.seq,
      // C2: record the stream so leave-purge can drop this entity in O(stream).
      stream: delta.stream,
    });
    store.clearNeedsRepair({collection: delta.collection, entityId: delta.id});
    advanceCursor();
    return {applied: true, seqJump};
  });
