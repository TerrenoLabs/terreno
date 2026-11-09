import {DateTime} from "luxon";
import type {MergeableContent} from "tinybase";

import type {SyncDb} from "../client";
import {listConflicts} from "../mutations/conflicts";
import {CURSORS_TABLE, KNOWN_STREAMS_TABLE, OUTBOX_TABLE} from "../storage/types";
import type {ConflictResolutionStrategy, SyncMutationOperation} from "../types";

const DEFAULT_ENTITY_LIMIT = 500;
const MAX_ENTITY_LIMIT = 2_000;

interface SyncDbDevtoolsInspectOptions {
  collection?: string;
  entityId?: string;
  includeDebugEvents?: boolean;
  limit?: number;
}

interface SyncDbDevtoolsMutation {
  collection: string;
  operation: SyncMutationOperation;
  id?: string;
  data?: Record<string, unknown>;
  maxAttempts?: number;
}

interface SyncDbDevtoolsState {
  capturedAt: string;
  name: string;
  status: ReturnType<SyncDb["getSyncStatus"]>;
  collections: Record<
    string,
    {
      entities: ReturnType<SyncDb["store"]["listEntities"]>;
      total: number;
      truncated: boolean;
    }
  >;
  outbox: Record<string, unknown>;
  conflicts: ReturnType<typeof listConflicts>;
  cursors: Record<string, unknown>;
  knownStreams: Record<string, unknown>;
  needsRepair: ReturnType<SyncDb["store"]["listNeedsRepair"]>;
  values: Record<string, unknown>;
  debug?: ReturnType<NonNullable<SyncDb["debug"]>["snapshot"]>;
}

interface SyncDbDevtoolsSnapshot extends SyncDbDevtoolsState {
  mergeableContent: unknown;
}

interface SyncDbDevtoolsClient {
  inspect: (options?: SyncDbDevtoolsInspectOptions) => SyncDbDevtoolsState;
  snapshot: (options?: SyncDbDevtoolsInspectOptions) => SyncDbDevtoolsSnapshot;
  mutate: (args: SyncDbDevtoolsMutation) => ReturnType<SyncDb["mutate"]>;
  setLocalEntity: (args: {
    collection: string;
    id: string;
    data: unknown;
    deleted?: boolean;
    seq?: number;
    stream?: string;
  }) => void;
  deleteLocalEntity: (args: {collection: string; id: string}) => void;
  merge: (content: unknown) => void;
  flush: () => Promise<void>;
  reconcile: () => Promise<void>;
  forceResync: () => ReturnType<SyncDb["forceResync"]>;
  resolveConflict: (args: {mutationId: string; strategy: ConflictResolutionStrategy}) => void;
  retryFailed: (args: {entityId: string}) => void;
  goOffline: () => void;
  goOnline: () => Promise<void>;
  clearDebug: () => void;
}

interface SyncDbDevtoolsRegistry {
  clients: Record<string, SyncDbDevtoolsClient>;
  list: () => string[];
}

const getRegistry = (): SyncDbDevtoolsRegistry => {
  const globalWithRegistry = globalThis as typeof globalThis & {
    __TERRENO_SYNCDB__?: SyncDbDevtoolsRegistry;
  };
  if (!globalWithRegistry.__TERRENO_SYNCDB__) {
    const clients: Record<string, SyncDbDevtoolsClient> = {};
    globalWithRegistry.__TERRENO_SYNCDB__ = {
      clients,
      list: (): string[] => Object.keys(clients).sort(),
    };
  }
  return globalWithRegistry.__TERRENO_SYNCDB__;
};

const decodeOutbox = (rows: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(rows).map(([mutationId, value]) => {
      const row =
        typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {value};
      let args: unknown = row.args;
      if (typeof row.args === "string") {
        try {
          args = JSON.parse(row.args);
        } catch {
          args = row.args;
        }
      }
      return [mutationId, {...row, args}];
    })
  );
};

export const registerSyncDbDevtools = ({client, name}: {client: SyncDb; name: string}): void => {
  const inspect = (options: SyncDbDevtoolsInspectOptions = {}): SyncDbDevtoolsState => {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_ENTITY_LIMIT, 1), MAX_ENTITY_LIMIT);
    const selectedCollections = options.collection
      ? [options.collection]
      : [...client.store.collections];
    const collections: SyncDbDevtoolsState["collections"] = {};

    for (const collection of selectedCollections) {
      const allEntities = options.entityId
        ? [
            client.store.getEntity({
              collection,
              id: options.entityId,
            }),
          ].filter((entity) => entity !== undefined)
        : client.store.listEntities({collection, includeDeleted: true});
      collections[collection] = {
        entities: allEntities.slice(0, limit),
        total: allEntities.length,
        truncated: allEntities.length > limit,
      };
    }

    return {
      capturedAt: DateTime.utc().toISO(),
      collections,
      conflicts: listConflicts({store: client.store}),
      cursors: client.store.raw.getTable(CURSORS_TABLE),
      ...(client.debug
        ? {
            debug:
              options.includeDebugEvents === false
                ? {
                    ...client.debug.snapshot(),
                    events: [],
                  }
                : client.debug.snapshot(),
          }
        : {}),
      knownStreams: client.store.raw.getTable(KNOWN_STREAMS_TABLE),
      name,
      needsRepair: client.store.listNeedsRepair(),
      outbox: decodeOutbox(client.store.raw.getTable(OUTBOX_TABLE)),
      status: client.getSyncStatus(),
      values: client.store.raw.getValues(),
    };
  };

  const devtoolsClient: SyncDbDevtoolsClient = {
    clearDebug: (): void => {
      client.debug?.clear();
    },
    deleteLocalEntity: ({collection, id}): void => {
      if (!client.store.collections.includes(collection)) {
        throw new Error(`Unknown collection "${collection}".`);
      }
      client.store.raw.delRow(collection, id);
    },
    flush: async (): Promise<void> => {
      await client.replayOutbox();
    },
    forceResync: client.forceResync,
    goOffline: client.goOffline,
    goOnline: client.goOnline,
    inspect,
    merge: (content): void => {
      client.store.raw.applyMergeableChanges(content as MergeableContent);
    },
    mutate: client.mutate,
    reconcile: client.reconcile,
    resolveConflict: client.resolveConflict,
    retryFailed: client.retryFailed,
    setLocalEntity: ({collection, id, data, deleted, seq, stream}): void => {
      client.store.upsertEntity({collection, data, deleted, id, seq, stream});
    },
    snapshot: (options = {}): SyncDbDevtoolsSnapshot => ({
      ...inspect(options),
      mergeableContent: client.store.raw.getMergeableContent(),
    }),
  };

  getRegistry().clients[name] = devtoolsClient;
};
