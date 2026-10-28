import {DateTime} from "luxon";

import {cdpRuntimeEvaluate, getCdpConnectionStatus} from "../metro/metroDevSession.js";

const SENSITIVE_FIELD_PATTERN = /(authorization|cookie|password|secret|token)/i;
const REDACTED_VALUE = "[REDACTED]";
const MAX_DIFFS = 200;

interface SyncDbBridgeClient {
  inspect: (options?: Record<string, unknown>) => unknown;
  snapshot: (options?: Record<string, unknown>) => unknown;
  mutate: (args: Record<string, unknown>) => unknown;
  setLocalEntity: (args: Record<string, unknown>) => void;
  deleteLocalEntity: (args: Record<string, unknown>) => void;
  merge: (content: unknown) => void;
  flush: () => Promise<void>;
  reconcile: () => Promise<void>;
  forceResync: () => Promise<unknown>;
  resolveConflict: (args: Record<string, unknown>) => void;
  retryFailed: (args: Record<string, unknown>) => void;
  goOffline: () => void;
  goOnline: () => Promise<void>;
  clearDebug: () => void;
}

interface SyncDbBridgeRegistry {
  clients: Record<string, SyncDbBridgeClient>;
  list: () => string[];
}

interface StoredSnapshot {
  id: string;
  capturedAt: string;
  clientName: string;
  state: Record<string, unknown>;
  mergeableContent: unknown;
}

export interface GetSyncDbStateArgs {
  name?: string;
  collection?: string;
  entityId?: string;
  includeDebugEvents?: boolean;
  limit?: number;
}

export interface SyncDbActionArgs {
  name?: string;
  action: string;
  collection?: string;
  id?: string;
  data?: Record<string, unknown>;
  deleted?: boolean;
  seq?: number;
  stream?: string;
  operation?: string;
  maxAttempts?: number;
  mutationId?: string;
  strategy?: string;
  entityId?: string;
  snapshotId?: string;
}

export interface SyncDbSnapshotArgs extends GetSyncDbStateArgs {
  action: string;
  snapshotId?: string;
  otherSnapshotId?: string;
}

const snapshots = new Map<string, StoredSnapshot>();
let nextSnapshotId = 1;

const getLocalRegistry = (): SyncDbBridgeRegistry | undefined => {
  return (
    globalThis as typeof globalThis & {
      __TERRENO_SYNCDB__?: SyncDbBridgeRegistry;
    }
  ).__TERRENO_SYNCDB__;
};

/** True when a SyncDB debug registry lives in this process (no CDP needed). */
export const hasLocalSyncDbRegistry = (): boolean => {
  return getLocalRegistry() !== undefined;
};

const redactValue = (value: unknown, key?: string): unknown => {
  if (key && SENSITIVE_FIELD_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey),
    ])
  );
};

const selectClient = (
  registry: SyncDbBridgeRegistry,
  requestedName?: string
): {client: SyncDbBridgeClient; name: string} => {
  const names = registry.list();
  const name = requestedName?.trim() || names[0];
  if (!name) {
    throw new Error(
      "No SyncDB client is registered. Create it with `debug: true` and keep the app running."
    );
  }
  const client = registry.clients[name];
  if (!client) {
    throw new Error(`Unknown SyncDB client "${name}". Available: ${names.join(", ") || "none"}.`);
  }
  return {client, name};
};

const buildRuntimeExpression = ({
  method,
  name,
  args,
}: {
  method: keyof SyncDbBridgeClient;
  name?: string;
  args?: unknown;
}): string => {
  const encodedName = JSON.stringify(name?.trim() || "");
  const encodedMethod = JSON.stringify(method);
  const encodedArgs = JSON.stringify(args ?? {});
  return `(async () => {
    const registry = globalThis.__TERRENO_SYNCDB__;
    if (!registry || !registry.clients || typeof registry.list !== "function") {
      return {ok: false, error: "no __TERRENO_SYNCDB__ registry"};
    }
    const names = registry.list();
    const name = ${encodedName} || names[0];
    const client = registry.clients[name];
    if (!client) {
      return {ok: false, error: "unknown SyncDB client", available: names};
    }
    try {
      const result = await client[${encodedMethod}](${encodedArgs});
      return {ok: true, name, result};
    } catch (error) {
      return {ok: false, error: String(error), name};
    }
  })()`;
};

const callBridge = async ({
  method,
  name,
  args,
}: {
  method: keyof SyncDbBridgeClient;
  name?: string;
  args?: unknown;
}): Promise<{name: string; result: unknown}> => {
  const localRegistry = getLocalRegistry();
  if (localRegistry) {
    const selected = selectClient(localRegistry, name);
    const callable = selected.client[method] as (input: unknown) => unknown;
    const result = await callable(args ?? {});
    return {name: selected.name, result};
  }

  const evaluated = await cdpRuntimeEvaluate(buildRuntimeExpression({args, method, name}), true);
  if (evaluated.error) {
    throw new Error(`${evaluated.error}\n${getCdpConnectionStatus()}`);
  }
  const payload = evaluated.value as
    | {ok?: boolean; error?: string; name?: string; result?: unknown; available?: string[]}
    | undefined;
  if (!payload?.ok || !payload.name) {
    throw new Error(
      `Could not access SyncDB in app: ${JSON.stringify(payload ?? evaluated.value)}\n${getCdpConnectionStatus()}`
    );
  }
  return {name: payload.name, result: payload.result};
};

const inspectOptions = (args: GetSyncDbStateArgs): Record<string, unknown> => ({
  ...(args.collection ? {collection: args.collection} : {}),
  ...(args.entityId ? {entityId: args.entityId} : {}),
  ...(typeof args.includeDebugEvents === "boolean"
    ? {includeDebugEvents: args.includeDebugEvents}
    : {}),
  ...(typeof args.limit === "number" ? {limit: args.limit} : {}),
});

export type SyncDbStateProbe = {found: true; state: unknown} | {found: false; reason: string};

/** Reads redacted SyncDB state in-process or over CDP, reporting why when no client is reachable. */
export const probeSyncDbState = async (args: GetSyncDbStateArgs): Promise<SyncDbStateProbe> => {
  try {
    const {result} = await callBridge({
      args: inspectOptions(args),
      method: "inspect",
      name: args.name,
    });
    return {found: true, state: redactValue(result)};
  } catch (error) {
    return {found: false, reason: String(error)};
  }
};

export const getSyncDbState = async (args: GetSyncDbStateArgs): Promise<string> => {
  const probe = await probeSyncDbState(args);
  if (!probe.found) {
    return probe.reason;
  }
  return JSON.stringify(probe.state, null, 2);
};

const requireMutationOptIn = (): string | undefined => {
  if (process.env.TERRENO_MCP_EVAL === "1" || process.env.TERRENO_MCP_EVAL === "true") {
    return undefined;
  }
  return "Refused: set `TERRENO_MCP_EVAL=1` to opt in to SyncDB state changes.";
};

const actionCall = (args: SyncDbActionArgs): {method: keyof SyncDbBridgeClient; input: unknown} => {
  switch (args.action) {
    case "mutate":
      return {
        input: {
          collection: args.collection,
          data: args.data,
          id: args.id,
          maxAttempts: args.maxAttempts,
          operation: args.operation,
        },
        method: "mutate",
      };
    case "setLocalEntity":
      return {
        input: {
          collection: args.collection,
          data: args.data,
          deleted: args.deleted,
          id: args.id,
          seq: args.seq,
          stream: args.stream,
        },
        method: "setLocalEntity",
      };
    case "deleteLocalEntity":
      return {
        input: {collection: args.collection, id: args.id},
        method: "deleteLocalEntity",
      };
    case "flush":
      return {input: {}, method: "flush"};
    case "reconcile":
      return {input: {}, method: "reconcile"};
    case "forceResync":
      return {input: {}, method: "forceResync"};
    case "resolveConflict":
      return {
        input: {mutationId: args.mutationId, strategy: args.strategy},
        method: "resolveConflict",
      };
    case "retryFailed":
      return {input: {entityId: args.entityId}, method: "retryFailed"};
    case "goOffline":
      return {input: {}, method: "goOffline"};
    case "goOnline":
      return {input: {}, method: "goOnline"};
    case "clearDebug":
      return {input: {}, method: "clearDebug"};
    case "mergeSnapshot": {
      const snapshot = args.snapshotId ? snapshots.get(args.snapshotId) : undefined;
      if (!snapshot) {
        throw new Error(`Unknown or missing snapshotId "${args.snapshotId ?? ""}".`);
      }
      if (args.name && args.name !== snapshot.clientName) {
        throw new Error(
          `Snapshot "${snapshot.id}" belongs to SyncDB client "${snapshot.clientName}", not "${args.name}".`
        );
      }
      return {input: snapshot.mergeableContent, method: "merge"};
    }
    default:
      throw new Error(`Unknown SyncDB action "${args.action}".`);
  }
};

export const syncDbAction = async (args: SyncDbActionArgs): Promise<string> => {
  const refusal = requireMutationOptIn();
  if (refusal) {
    return refusal;
  }
  try {
    const call = actionCall(args);
    const snapshotClientName =
      args.action === "mergeSnapshot" && args.snapshotId
        ? snapshots.get(args.snapshotId)?.clientName
        : undefined;
    const actionResult = await callBridge({
      args: call.input,
      method: call.method,
      name: args.name ?? snapshotClientName,
    });
    const state = await callBridge({
      args: {includeDebugEvents: false},
      method: "inspect",
      name: actionResult.name,
    });
    return JSON.stringify(
      redactValue({
        action: args.action,
        client: actionResult.name,
        result: actionResult.result,
        state: state.result,
      }),
      null,
      2
    );
  } catch (error) {
    return String(error);
  }
};

const snapshotPublicState = (snapshot: StoredSnapshot): Record<string, unknown> => ({
  capturedAt: snapshot.capturedAt,
  clientName: snapshot.clientName,
  id: snapshot.id,
  state: redactValue(snapshot.state),
});

const diffValues = ({
  left,
  right,
  path = "$",
  diffs,
}: {
  left: unknown;
  right: unknown;
  path?: string;
  diffs: Array<{path: string; before?: unknown; after?: unknown}>;
}): void => {
  if (diffs.length >= MAX_DIFFS || Object.is(left, right)) {
    return;
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    diffs.push({after: redactValue(right), before: redactValue(left), path});
    return;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of [...keys].sort()) {
    diffValues({
      diffs,
      left: leftRecord[key],
      path: `${path}.${key}`,
      right: rightRecord[key],
    });
    if (diffs.length >= MAX_DIFFS) {
      return;
    }
  }
};

const compareSnapshots = (left: StoredSnapshot, right: StoredSnapshot): Record<string, unknown> => {
  const diffs: Array<{path: string; before?: unknown; after?: unknown}> = [];
  diffValues({diffs, left: left.state, right: right.state});
  return {
    diffCount: diffs.length,
    diffs,
    left: {capturedAt: left.capturedAt, id: left.id},
    right: {capturedAt: right.capturedAt, id: right.id},
    truncated: diffs.length >= MAX_DIFFS,
  };
};

export const syncDbSnapshot = async (args: SyncDbSnapshotArgs): Promise<string> => {
  try {
    if (args.action === "list") {
      return JSON.stringify(
        [...snapshots.values()].map(({id, capturedAt, clientName}) => ({
          capturedAt,
          clientName,
          id,
        })),
        null,
        2
      );
    }
    if (args.action === "get") {
      const snapshot = args.snapshotId ? snapshots.get(args.snapshotId) : undefined;
      return snapshot
        ? JSON.stringify(snapshotPublicState(snapshot), null, 2)
        : `Unknown or missing snapshotId "${args.snapshotId ?? ""}".`;
    }
    if (args.action === "delete") {
      const deleted = args.snapshotId ? snapshots.delete(args.snapshotId) : false;
      return JSON.stringify({deleted, snapshotId: args.snapshotId}, null, 2);
    }
    if (args.action === "compare") {
      const left = args.snapshotId ? snapshots.get(args.snapshotId) : undefined;
      const right = args.otherSnapshotId ? snapshots.get(args.otherSnapshotId) : undefined;
      if (!left || !right) {
        return "Both snapshotId and otherSnapshotId must name captured snapshots.";
      }
      return JSON.stringify(compareSnapshots(left, right), null, 2);
    }
    if (args.action !== "capture") {
      return `Unknown snapshot action "${args.action}".`;
    }

    const {name, result} = await callBridge({
      args: inspectOptions(args),
      method: "snapshot",
      name: args.name,
    });
    const raw = result as Record<string, unknown>;
    const mergeableContent = raw.mergeableContent;
    const state = {...raw};
    delete state.capturedAt;
    delete state.mergeableContent;
    const capturedAt = DateTime.utc().toISO();
    const id = `syncdb-${capturedAt.replaceAll(/[^0-9]/g, "").slice(0, 17)}-${nextSnapshotId++}`;
    const snapshot: StoredSnapshot = {
      capturedAt,
      clientName: name,
      id,
      mergeableContent,
      state,
    };
    snapshots.set(id, snapshot);
    return JSON.stringify(snapshotPublicState(snapshot), null, 2);
  } catch (error) {
    return String(error);
  }
};

/** @internal */
export const clearSyncDbSnapshotsForTests = (): void => {
  snapshots.clear();
  nextSnapshotId = 1;
};
