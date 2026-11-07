import {DateTime} from "luxon";
import {createMergeableStore, type MergeableStore, type Row} from "tinybase";

import {buildTablesSchema, SYNC_SCHEMA_VERSION, SYNC_VALUES_SCHEMA} from "./schema";
import {
  CURSORS_TABLE,
  type EntityRow,
  KNOWN_STREAMS_TABLE,
  NEEDS_REPAIR_TABLE,
  type NeedsRepairRow,
  RESERVED_TABLE_PREFIX,
  type SyncEntity,
} from "./types";

const defaultNow = (): string => DateTime.now().toISO();

const encodeData = (data: unknown): string => JSON.stringify(data ?? null);

const decodeData = <TData>(raw: string | undefined): TData => {
  if (raw === undefined) {
    return null as TData;
  }
  try {
    return JSON.parse(raw) as TData;
  } catch (error) {
    // A single corrupt/legacy row must never take down a local-first list read.
    console.warn("[syncdb] failed to decode entity payload; returning null", error);
    return null as TData;
  }
};

const rowToEntity = <TData>(id: string, row: Partial<EntityRow>): SyncEntity<TData> => {
  const entity: SyncEntity<TData> = {
    data: decodeData<TData>(row.data),
    deleted: Boolean(row.deleted),
    deletedAt: row.deletedAt ? row.deletedAt : undefined,
    id,
    pendingMutationId: row.pendingMutationId ? row.pendingMutationId : undefined,
    seq: row.seq ?? 0,
    stream: row.stream ? row.stream : undefined,
  };
  if (row.awaitingServerDelta) {
    entity.awaitingServerDelta = true;
  }
  return entity;
};

interface UpsertEntityArgs {
  collection: string;
  id: string;
  data: unknown;
  /** Server seq for this entity; omitted = preserve existing (0 when new). */
  seq?: number;
  /** Tombstone flag; omitted = preserve existing (false when new). */
  deleted?: boolean;
  /** Protecting outbox mutation; omitted = preserve existing, "" = clear. */
  pendingMutationId?: string;
  /** C2: the stream this entity was written under; omitted = preserve existing. */
  stream?: string;
  /**
   * True when this write is the mutation ACK stamping `seq` ahead of the
   * server delta. False clears it. Omitted keeps it, unless `data` or
   * `deleted` changed, which means a newer local edit and clears it.
   */
  awaitingServerDelta?: boolean;
}

interface CompactTombstonesResult {
  /** Number of tombstone rows removed (across all configured collections). */
  removed: number;
}

export interface SyncStore {
  /** Underlying TinyBase MergeableStore (CRDT-capable, persistence-ready). */
  readonly raw: MergeableStore;
  /** Collections this store was configured with. */
  readonly collections: readonly string[];
  upsertEntity: (args: UpsertEntityArgs) => SyncEntity;
  getEntity: <TData = unknown>(args: {
    collection: string;
    id: string;
  }) => SyncEntity<TData> | undefined;
  listEntities: <TData = unknown>(args: {
    collection: string;
    includeDeleted?: boolean;
  }) => SyncEntity<TData>[];
  /**
   * Every row across every configured collection that currently carries a
   * `pendingMutationId`, tombstones included. Used by the startup sweep that
   * releases pendings whose outbox row no longer exists (Task 9.11b) — such a
   * row is frozen otherwise, since the delta applier skips it for pending
   * protection and repair refuses to overwrite it.
   */
  listPendingEntities: () => Array<{
    collection: string;
    entityId: string;
    pendingMutationId: string;
  }>;
  softDeleteEntity: (args: {collection: string; id: string}) => void;
  clearCollection: (args: {collection: string}) => void;
  getSchemaVersion: () => number;
  getLastUserId: () => string | undefined;
  setLastUserId: (args: {userId: string}) => void;
  /**
   * E5: delete local tombstone rows (`deleted: true`) whose `deletedAt` is
   * older than `olderThanMs` (from `now`), across every configured
   * collection, in one transaction. Tombstones with no `deletedAt` (applied
   * before this cell existed) are left alone — there is no reliable age to
   * compare, and it is safer to under-compact than to drop a tombstone a
   * client hasn't actually converged on yet.
   */
  compactTombstones: (args: {olderThanMs: number; now?: () => string}) => CompactTombstonesResult;
  /** C2: stream keys the client has bootstrapped (the persisted membership set). */
  getKnownStreams: () => string[];
  /** C2: record a stream as bootstrapped (join). */
  addKnownStream: (args: {stream: string; collection: string}) => void;
  /** C2: forget a bootstrapped stream (leave). */
  removeKnownStream: (args: {stream: string}) => void;
  /**
   * C2 leave-purge: delete every local entity written under `stream` (matched on the
   * entity `stream` column) across all collections, and its cursor + known-stream entry.
   * Returns the number of entities purged.
   */
  purgeStream: (args: {stream: string}) => number;
  /**
   * Delete rows in `collection` that carry no stream provenance (`stream` is "")
   * and have no pending outbox mutation. These are either phantoms left by a
   * locally-failed create the server never accepted, or legacy rows written
   * before stream stamping — a re-bootstrap restores anything the server still
   * has. Rows protected by a pending mutation are always kept.
   */
  purgeUnknownStreamEntities: (args: {collection: string}) => number;
  /** Record that server state for an entity was skipped while pending-protected. */
  markNeedsRepair: (args: {
    collection: string;
    entityId: string;
    missedSeq: number;
    stream: string;
  }) => void;
  clearNeedsRepair: (args: {collection: string; entityId: string}) => void;
  hasNeedsRepair: (args: {collection: string; entityId: string}) => boolean;
  listNeedsRepair: () => Array<{
    collection: string;
    entityId: string;
    missedSeq: number;
    stream: string;
  }>;
  clearNeedsRepairForStream: (args: {stream: string}) => void;
}

/**
 * Create a schema-bound TinyBase MergeableStore wrapped with typed,
 * collection-aware entity accessors. A MergeableStore (rather than a plain
 * Store) is used deliberately so the local data is CRDT-ready from day one.
 * Every accessor validates its collection against the configured list so a
 * typo'd collection fails loudly instead of silently writing to a stray table.
 */
export const createSyncStore = ({
  collections,
  now = defaultNow,
}: {
  collections: string[];
  /** ISO clock, injectable for deterministic E5 tombstone-retention tests. */
  now?: () => string;
}): SyncStore => {
  for (const collection of collections) {
    if (collection.startsWith(RESERVED_TABLE_PREFIX)) {
      throw new Error(
        `Collection names must not start with "${RESERVED_TABLE_PREFIX}" (reserved for internal tables): ${collection}`
      );
    }
  }
  const known = new Set(collections);
  if (known.size !== collections.length) {
    throw new Error(`Duplicate collection names: ${collections.join(", ")}`);
  }

  const raw = createMergeableStore();
  raw.setTablesSchema(buildTablesSchema({collections}));
  raw.setValuesSchema(SYNC_VALUES_SCHEMA);

  const assertCollection = (collection: string): void => {
    if (!known.has(collection)) {
      throw new Error(`Unknown collection "${collection}" (configured: ${collections.join(", ")})`);
    }
  };

  const upsertEntity = (args: UpsertEntityArgs): SyncEntity => {
    assertCollection(args.collection);
    const existing = raw.hasRow(args.collection, args.id)
      ? (raw.getRow(args.collection, args.id) as Partial<EntityRow>)
      : undefined;
    const deleted = args.deleted ?? existing?.deleted ?? false;
    const encodedData = encodeData(args.data);
    const contentChanged =
      existing !== undefined &&
      (encodedData !== (existing.data ?? "null") || deleted !== Boolean(existing.deleted));
    const awaitingServerDelta =
      args.awaitingServerDelta !== undefined
        ? args.awaitingServerDelta
        : contentChanged
          ? false
          : Boolean(existing?.awaitingServerDelta);
    const row: EntityRow = {
      awaitingServerDelta,
      data: encodedData,
      deleted,
      // E5: stamp deletedAt the moment a row FIRST becomes a tombstone (not
      // on every subsequent upsert while it stays deleted, and never on a
      // resurrection back to deleted: false — clear it instead). Empty
      // string (what a never-deleted row carries) must be treated the same as
      // "absent" here — `??` alone does not do that.
      deletedAt: deleted ? existing?.deletedAt || now() : "",
      pendingMutationId: args.pendingMutationId ?? existing?.pendingMutationId ?? "",
      seq: args.seq ?? existing?.seq ?? 0,
      stream: args.stream ?? existing?.stream ?? "",
    };
    raw.setRow(args.collection, args.id, row as unknown as Row);
    return rowToEntity(args.id, row);
  };

  const getEntity = <TData = unknown>(args: {
    collection: string;
    id: string;
  }): SyncEntity<TData> | undefined => {
    assertCollection(args.collection);
    if (!raw.hasRow(args.collection, args.id)) {
      return undefined;
    }
    return rowToEntity<TData>(args.id, raw.getRow(args.collection, args.id) as Partial<EntityRow>);
  };

  const listEntities = <TData = unknown>(args: {
    collection: string;
    includeDeleted?: boolean;
  }): SyncEntity<TData>[] => {
    assertCollection(args.collection);
    const table = raw.getTable(args.collection);
    const entities: SyncEntity<TData>[] = [];
    for (const [id, row] of Object.entries(table)) {
      const entity = rowToEntity<TData>(id, row as Partial<EntityRow>);
      if (!args.includeDeleted && entity.deleted) {
        continue;
      }
      entities.push(entity);
    }
    return entities;
  };

  const listPendingEntities = (): Array<{
    collection: string;
    entityId: string;
    pendingMutationId: string;
  }> => {
    const pending: Array<{collection: string; entityId: string; pendingMutationId: string}> = [];
    for (const collection of collections) {
      for (const [id, row] of Object.entries(raw.getTable(collection))) {
        const pendingMutationId = (row as Partial<EntityRow>).pendingMutationId;
        if (!pendingMutationId) {
          continue;
        }
        pending.push({collection, entityId: id, pendingMutationId});
      }
    }
    return pending;
  };

  const softDeleteEntity = (args: {collection: string; id: string}): void => {
    assertCollection(args.collection);
    if (!raw.hasRow(args.collection, args.id)) {
      return;
    }
    raw.transaction(() => {
      raw.setCell(args.collection, args.id, "deleted", true);
      // E5: stamp deletedAt only on the transition into a tombstone — a
      // second softDeleteEntity call on an already-deleted row (idempotent)
      // must not push the age-out clock forward.
      const currentDeletedAt = raw.getCell(args.collection, args.id, "deletedAt");
      if (!currentDeletedAt) {
        raw.setCell(args.collection, args.id, "deletedAt", now());
      }
    });
  };

  const clearCollection = (args: {collection: string}): void => {
    assertCollection(args.collection);
    raw.delTable(args.collection);
  };

  const getSchemaVersion = (): number => {
    const version = raw.getValue("schemaVersion");
    return typeof version === "number" ? version : SYNC_SCHEMA_VERSION;
  };

  const getLastUserId = (): string | undefined => {
    const userId = raw.getValue("lastUserId");
    return typeof userId === "string" && userId !== "" ? userId : undefined;
  };

  const setLastUserId = ({userId}: {userId: string}): void => {
    raw.setValue("lastUserId", userId);
  };

  const compactTombstones = ({
    olderThanMs,
    now: compactionNow = now,
  }: {
    olderThanMs: number;
    now?: () => string;
  }): CompactTombstonesResult => {
    const cutoff = DateTime.fromISO(compactionNow()).minus({milliseconds: olderThanMs});
    return raw.transaction(() => {
      let removed = 0;
      for (const collection of collections) {
        const table = raw.getTable(collection);
        for (const [id, row] of Object.entries(table)) {
          const typedRow = row as Partial<EntityRow>;
          if (!typedRow.deleted || !typedRow.deletedAt) {
            continue;
          }
          const deletedAt = DateTime.fromISO(typedRow.deletedAt);
          if (!deletedAt.isValid || deletedAt < cutoff) {
            raw.delRow(collection, id);
            removed += 1;
          }
        }
      }
      return {removed};
    });
  };

  const getKnownStreams = (): string[] => Object.keys(raw.getTable(KNOWN_STREAMS_TABLE));

  const addKnownStream = ({stream, collection}: {stream: string; collection: string}): void => {
    raw.setRow(KNOWN_STREAMS_TABLE, stream, {
      addedAt: now(),
      collection,
    } as unknown as Row);
  };

  const removeKnownStream = ({stream}: {stream: string}): void => {
    raw.delRow(KNOWN_STREAMS_TABLE, stream);
  };

  const needsRepairKey = (collection: string, entityId: string): string =>
    `${collection}:${entityId}`;

  const markNeedsRepair = ({
    collection,
    entityId,
    missedSeq,
    stream,
  }: {
    collection: string;
    entityId: string;
    missedSeq: number;
    stream: string;
  }): void => {
    const rowId = needsRepairKey(collection, entityId);
    const existing = raw.getRow(NEEDS_REPAIR_TABLE, rowId) as Partial<NeedsRepairRow> | undefined;
    const priorMissed = typeof existing?.missedSeq === "number" ? existing.missedSeq : 0;
    raw.setRow(NEEDS_REPAIR_TABLE, rowId, {
      collection,
      entityId,
      markedAt: now(),
      missedSeq: Math.max(priorMissed, missedSeq),
      stream,
    } as unknown as Row);
  };

  const clearNeedsRepair = ({
    collection,
    entityId,
  }: {
    collection: string;
    entityId: string;
  }): void => {
    raw.delRow(NEEDS_REPAIR_TABLE, needsRepairKey(collection, entityId));
  };

  const hasNeedsRepair = ({
    collection,
    entityId,
  }: {
    collection: string;
    entityId: string;
  }): boolean => {
    return raw.hasRow(NEEDS_REPAIR_TABLE, needsRepairKey(collection, entityId));
  };

  const listNeedsRepair = (): Array<{
    collection: string;
    entityId: string;
    missedSeq: number;
    stream: string;
  }> => {
    const rows = raw.getTable(NEEDS_REPAIR_TABLE);
    return Object.entries(rows).map(([rowId, row]) => {
      const typed = row as Partial<NeedsRepairRow>;
      const collection = typed.collection ?? rowId.split(":")[0] ?? "";
      const entityId = typed.entityId ?? rowId.split(":").slice(1).join(":") ?? "";
      return {
        collection,
        entityId,
        missedSeq: typed.missedSeq ?? 0,
        stream: typed.stream ?? "",
      };
    });
  };

  const clearNeedsRepairForStream = ({stream}: {stream: string}): void => {
    const rows = raw.getTable(NEEDS_REPAIR_TABLE);
    for (const [rowId, row] of Object.entries(rows)) {
      if ((row as Partial<NeedsRepairRow>).stream === stream) {
        raw.delRow(NEEDS_REPAIR_TABLE, rowId);
      }
    }
  };

  const purgeUnknownStreamEntities = ({collection}: {collection: string}): number => {
    assertCollection(collection);
    return raw.transaction(() => {
      let purged = 0;
      const table = raw.getTable(collection);
      for (const [id, row] of Object.entries(table)) {
        const typed = row as Partial<EntityRow>;
        if (typed.stream) {
          continue;
        }
        if (typed.pendingMutationId) {
          continue;
        }
        raw.delRow(collection, id);
        clearNeedsRepair({collection, entityId: id});
        purged += 1;
      }
      return purged;
    });
  };

  const purgeStream = ({stream}: {stream: string}): number => {
    // C2 leave-purge deletes rows outright, so E5 deletedAt tombstone semantics
    // do not apply here — a purged stream is gone locally, not soft-deleted.
    let purged = 0;
    for (const collection of collections) {
      const table = raw.getTable(collection);
      for (const [id, row] of Object.entries(table)) {
        if ((row as Partial<EntityRow>).stream === stream) {
          raw.delRow(collection, id);
          purged += 1;
        }
      }
    }
    raw.delRow(CURSORS_TABLE, stream);
    removeKnownStream({stream});
    clearNeedsRepairForStream({stream});
    return purged;
  };

  return {
    addKnownStream,
    clearCollection,
    clearNeedsRepair,
    clearNeedsRepairForStream,
    collections,
    compactTombstones,
    getEntity,
    getKnownStreams,
    getLastUserId,
    getSchemaVersion,
    hasNeedsRepair,
    listEntities,
    listNeedsRepair,
    listPendingEntities,
    markNeedsRepair,
    purgeStream,
    purgeUnknownStreamEntities,
    raw,
    removeKnownStream,
    setLastUserId,
    softDeleteEntity,
    upsertEntity,
  };
};
