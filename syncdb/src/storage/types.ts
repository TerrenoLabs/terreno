/**
 * Internal TinyBase table layout for the local-first store.
 *
 * Entity tables are named after their collection (e.g. "todos"); reserved
 * infrastructure tables are prefixed with "_" so they can never collide with a
 * collection name (collection names starting with "_" are rejected at store
 * creation). TinyBase cells only hold primitives (string | number | boolean),
 * so rich payloads are JSON-encoded into `data`/`args` cells; the `*Row`
 * interfaces below describe those primitive shapes, while the decoded,
 * application-facing shapes live in `../types`.
 */

import type {OutboxStatus, SyncMutationOperation} from "../types";

/** Reserved table holding durable outbox mutations; rowId = mutationId. */
export const OUTBOX_TABLE = "_outbox";

/** Reserved table holding per-stream sync cursors; rowId = stream key. */
export const CURSORS_TABLE = "_cursors";

/** Reserved table holding unresolved conflicts; rowId = mutationId. */
export const CONFLICTS_TABLE = "_conflicts";

/**
 * C2: reserved table recording the streams the client has bootstrapped (membership set);
 * rowId = stream key. Diffed against `GET /sync/streams` to detect joins (backfill) and
 * leaves (purge), the latter only on a confirmed HTTP-200 membership change (INV-2).
 */
export const KNOWN_STREAMS_TABLE = "_knownStreams";

/**
 * Entities whose server deltas were skipped while a pending outbox mutation
 * protected optimistic state. The cursor advanced past the missed seq, so the
 * entity must be re-fetched once the pending mutation resolves without a server ack.
 */
export const NEEDS_REPAIR_TABLE = "_needsRepair";

/**
 * Server query-window membership (see `query/queryWindows.ts`); rowId = window key.
 * Holds ordered member ids only — the rows themselves live in the shared entity table.
 */
export const QUERY_WINDOWS_TABLE = "_queryWindows";

/** Prefix marking reserved (non-collection) tables. */
export const RESERVED_TABLE_PREFIX = "_";

/** Primitive row shape for a `{collection}` entity table; rowId = entity id. */
export interface EntityRow {
  /** JSON-encoded entity payload. */
  data: string;
  /** Soft-delete tombstone flag. */
  deleted: boolean;
  /**
   * ISO-8601 timestamp stamped the moment a tombstone (`deleted: true`) is
   * first applied locally (empty string when not a tombstone, or for
   * tombstones applied before this cell existed). E5's client-side
   * compaction ages tombstones out from this timestamp, not `updated`/
   * `created`, since a tombstone's local arrival time is what determines when
   * it is safe to drop (it must survive at least as long as the server's own
   * retention window, C7).
   */
  deletedAt: string;
  /** Outbox mutation currently protecting this entity's optimistic state ("" = none). */
  pendingMutationId: string;
  /** Highest server seq applied to this entity (0 = local-only, never synced). */
  seq: number;
  /**
   * C2: the stream key this entity was last written under (delta/snapshot). Recorded at
   * apply time so leave-purge can drop a stream's entities in O(stream) without
   * recomputing scope. "" for local-only entities never synced from the server.
   */
  stream: string;
}

/** Primitive row shape for the `_outbox` table; rowId = mutationId. */
export interface OutboxRow {
  /** JSON-encoded mutation args. */
  args: string;
  /** Diagnostic total attempt count across every send (transport + error-nack). */
  attemptCount: number;
  /**
   * Retry budget counter incremented ONLY on server error-nacks; transport
   * failures never touch this cell (they get unlimited retries). Terminality
   * (`MAX_ERROR_NACK_ATTEMPTS`) is checked against this, not `attemptCount`.
   */
  errorNackCount: number;
  /** Per-mutation error-nack budget; absent cell → engine default in replay. */
  maxAttempts?: number;
  /** Absent when the mutation carries no base version (e.g. creates). */
  baseVersion?: number;
  collection: string;
  createdAt: string;
  /** Monotonic insertion counter; FIFO tiebreaker when createdAt collides. */
  enqueueOrder: number;
  entityId: string;
  operation: SyncMutationOperation;
  status: OutboxStatus;
  userId: string;
  mutationMode?: "adminWindow";
}

/** Primitive row shape for the `_cursors` table; rowId = stream key. */
export interface CursorRow {
  /** Highest seq applied for the stream (advanced by both deltas and snapshot pages). */
  seq: number;
  updatedAt: string;
  /**
   * Highest seq paged through the snapshot endpoint — bootstrap's own resume
   * point, deliberately separate from `seq`. A live delta advances `seq` to the
   * stream head regardless of how far bootstrap has got, so `seq` cannot be used
   * to resume an interrupted bootstrap without permanently skipping every seq in
   * between (see `sync/cursor.ts`). Absent on streams that predate this cell.
   */
  snapshotSeq?: number;
  /** True once a snapshot pass reached the stream head (`hasMore: false`). */
  bootstrapped?: boolean;
}

/** Primitive row shape for the `_needsRepair` table; rowId = `${collection}:${entityId}`. */
export interface NeedsRepairRow {
  collection: string;
  entityId: string;
  /** Highest server seq skipped while the entity was pending-protected. */
  missedSeq: number;
  /** Stream the skipped delta arrived on (used when applying the repair). */
  stream: string;
  markedAt: string;
}

/** Primitive row shape for the `_conflicts` table; rowId = mutationId. */
export interface ConflictRow {
  collection: string;
  dismissed: boolean;
  entityId: string;
  /** JSON-encoded local (optimistic) entity data. */
  localData: string;
  /** JSON-encoded canonical server entity data. */
  serverData: string;
  serverSeq: number;
  /** True when the server side of the conflict is a tombstone (Task 9.12). */
  serverDeleted?: boolean;
}

/** Decoded, application-facing entity record returned by store accessors. */
export interface SyncEntity<TData = unknown> {
  /** Decoded entity payload. */
  data: TData;
  /** Soft-delete tombstone flag. */
  deleted: boolean;
  /** ISO-8601 timestamp the tombstone was first applied; undefined when not a tombstone. */
  deletedAt?: string;
  /** Entity id (the TinyBase row id). */
  id: string;
  /** Outbox mutation currently protecting this entity, if any. */
  pendingMutationId?: string;
  /** Highest server seq applied to this entity (0 = local-only). */
  seq: number;
  /** C2: the stream key this entity was last written under ("" for local-only). */
  stream?: string;
}
