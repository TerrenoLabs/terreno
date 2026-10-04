import type {CellSchema, TablesSchema, ValuesSchema} from "tinybase";

import {
  CONFLICTS_TABLE,
  CURSORS_TABLE,
  KNOWN_STREAMS_TABLE,
  NEEDS_REPAIR_TABLE,
  OUTBOX_TABLE,
  QUERY_WINDOWS_TABLE,
} from "./types";

/**
 * Current local schema version. Bump when the table shapes change.
 * v2 (C2): entity rows gained a `stream` column; added the `_knownStreams` table.
 * v3: cursor rows gained `snapshotSeq` + `bootstrapped`. The bump is also the
 * repair path for stores written by v2, where an interrupted bootstrap could
 * leave the cursor at the stream head with only part of the snapshot applied —
 * unreachable by any later reconcile, so a wipe + full re-bootstrap is the only
 * way to make those stores whole.
 */
export const SYNC_SCHEMA_VERSION = 3;

const ENTITY_TABLE_SCHEMA: Record<string, CellSchema> = {
  data: {type: "string"},
  deleted: {type: "boolean"},
  /** E5: stamped when a tombstone is first applied; "" otherwise. */
  deletedAt: {type: "string"},
  pendingMutationId: {type: "string"},
  seq: {type: "number"},
  stream: {type: "string"},
};

/**
 * Build the TinyBase tables schema for a store configured with the given
 * collections. All reserved tables are defined up front (even where operations
 * land in later phases) so the persisted serialization format stays stable and
 * avoids client-side schema migrations.
 *
 * No cell declares a `default`. A MergeableStore keeps a CRDT tombstone for
 * every deleted row, and loading that tombstone back re-applies the schema:
 * any cell with a default is re-created, resurrecting the deleted row as a
 * husk holding only its defaults. That turned every resolved conflict into a
 * phantom `_conflicts` row after a reload (`collection: ""`, which threw
 * `Unknown collection ""` when resolved) and left ghost rows in `_outbox`,
 * `_cursors`, and the entity tables. Writers always set every cell explicitly
 * and readers already substitute their own fallbacks for an absent cell, so
 * dropping the defaults costs nothing and keeps deleted rows deleted.
 */
export const buildTablesSchema = ({collections}: {collections: string[]}): TablesSchema => {
  const schema: TablesSchema = {
    [CONFLICTS_TABLE]: {
      collection: {type: "string"},
      dismissed: {type: "boolean"},
      entityId: {type: "string"},
      localData: {type: "string"},
      serverData: {type: "string"},
      /** Task 9.12: server side of the conflict is a tombstone. */
      serverDeleted: {type: "boolean"},
      serverSeq: {type: "number"},
    },
    [CURSORS_TABLE]: {
      bootstrapped: {type: "boolean"},
      seq: {type: "number"},
      snapshotSeq: {type: "number"},
      updatedAt: {type: "string"},
    },
    [KNOWN_STREAMS_TABLE]: {
      addedAt: {type: "string"},
      collection: {type: "string"},
    },
    [NEEDS_REPAIR_TABLE]: {
      collection: {type: "string"},
      entityId: {type: "string"},
      markedAt: {type: "string"},
      missedSeq: {type: "number"},
      stream: {type: "string"},
    },
    [OUTBOX_TABLE]: {
      args: {type: "string"},
      attemptCount: {type: "number"},
      baseVersion: {type: "number"},
      collection: {type: "string"},
      createdAt: {type: "string"},
      enqueueOrder: {type: "number"},
      entityId: {type: "string"},
      errorNackCount: {type: "number"},
      maxAttempts: {type: "number"},
      mutationMode: {type: "string"},
      operation: {type: "string"},
      status: {type: "string"},
      userId: {type: "string"},
    },
    [QUERY_WINDOWS_TABLE]: {
      collection: {type: "string"},
      /** JSON-encoded {id: seq} of cached rows the last full fetch proved stale for the window. */
      excluded: {type: "string"},
      fetchedAt: {type: "string"},
      hasMore: {type: "boolean"},
      /** JSON-encoded ordered member ids. */
      ids: {type: "string"},
      pages: {type: "number"},
      /** Server total, or -1 when the endpoint did not report one. */
      total: {type: "number"},
    },
  };
  for (const collection of collections) {
    schema[collection] = {...ENTITY_TABLE_SCHEMA};
  }
  return schema;
};

/** Store-level values schema: schema version + last authenticated user. */
export const SYNC_VALUES_SCHEMA: ValuesSchema = {
  lastUserId: {default: "", type: "string"},
  /** O(1) FIFO ordering cell: the highest `enqueueOrder` handed out so far. */
  outboxMaxEnqueueOrder: {default: 0, type: "number"},
  schemaVersion: {default: SYNC_SCHEMA_VERSION, type: "number"},
};
