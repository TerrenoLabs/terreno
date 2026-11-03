import {
  cdpRuntimeEvaluate,
  ensureCdpConnected,
  getCdpConnectionStatus,
} from "../metro/metroDevSession.js";
import {hasLocalSyncDbRegistry, probeSyncDbState, type SyncDbStateProbe} from "./syncDb.js";

interface TerrenoDevStore {
  getState: () => Record<string, unknown>;
}

const SENSITIVE_STATE_FIELD_PATTERN = /(authorization|cookie|password|secret|token)/i;
const REDACTED_STATE_VALUE = "[REDACTED]";

const getDevStore = (): TerrenoDevStore | undefined => {
  return (globalThis as typeof globalThis & {__TERRENO_STORE__?: TerrenoDevStore})
    .__TERRENO_STORE__;
};

const redactStateValue = (value: unknown, key?: string): unknown => {
  if (key && SENSITIVE_STATE_FIELD_PATTERN.test(key)) {
    return REDACTED_STATE_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStateValue(item));
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactStateValue(entryValue, entryKey),
    ])
  );
};

const summarizeRtkCache = (state: Record<string, unknown>): unknown => {
  const apiState = state["terreno-rtk"] as
    | {
        queries?: Record<string, {status?: string; endpointName?: string; originalArgs?: unknown}>;
        mutations?: Record<
          string,
          {status?: string; endpointName?: string; originalArgs?: unknown}
        >;
      }
    | undefined;
  if (!apiState) {
    return {note: "No terreno-rtk slice found on store."};
  }
  const queries = apiState.queries ?? {};
  const mutations = apiState.mutations ?? {};
  const qList = Object.values(queries).map((q) => ({
    args: redactStateValue(q.originalArgs),
    endpoint: q.endpointName,
    status: q.status,
  }));
  const mList = Object.values(mutations).map((m) => ({
    args: redactStateValue(m.originalArgs),
    endpoint: m.endpointName,
    status: m.status,
  }));
  return {mutations: mList, queries: qList};
};

const filterByQuery = (data: unknown, query: string | undefined): unknown => {
  if (!query?.trim()) {
    return data;
  }
  const q = query.trim().toLowerCase();
  if (typeof data !== "object" || data === null) {
    return data;
  }
  const tr = data as {queries?: unknown[]; mutations?: unknown[]};
  if (!Array.isArray(tr.queries) && !Array.isArray(tr.mutations)) {
    return data;
  }
  const matchEndpoint = (row: unknown): boolean => {
    if (typeof row !== "object" || row === null) {
      return false;
    }
    const r = row as {endpoint?: string; args?: unknown};
    const ep = (r.endpoint ?? "").toString().toLowerCase();
    const args = JSON.stringify(r.args ?? {}).toLowerCase();
    return ep.includes(q) || args.includes(q);
  };
  return {
    ...tr,
    mutations: Array.isArray(tr.mutations) ? tr.mutations.filter(matchEndpoint) : tr.mutations,
    queries: Array.isArray(tr.queries) ? tr.queries.filter(matchEndpoint) : tr.queries,
  };
};

const summarizeClientState = (
  state: Record<string, unknown>,
  slice: string | undefined,
  query: string | undefined
): unknown => {
  const auth = redactStateValue(state.betterAuth ?? state.auth);
  if (slice === "auth") {
    return {auth};
  }
  if (slice === "betterAuth") {
    return {betterAuth: redactStateValue(state.betterAuth)};
  }
  if (slice === "terreno-rtk" || slice === "rtk") {
    return filterByQuery(summarizeRtkCache(state), query);
  }
  if (slice) {
    return {[slice]: redactStateValue(state[slice])};
  }
  return {
    auth,
    terrenoRtk: filterByQuery(summarizeRtkCache(state), query),
  };
};

export interface GetClientStateArgs {
  /** RTK: `auth`, `betterAuth`, `rtk`/`terreno-rtk`, or any top-level Redux state key. */
  slice?: string;
  /** RTK: filter cache rows by endpoint name or serialized args. */
  query?: string;
  /** SyncDB: client name; defaults to the first registered client. */
  name?: string;
  /** SyncDB: collection filter. */
  collection?: string;
  /** SyncDB: entity id filter. */
  entityId?: string;
  /** SyncDB: set false to return debug stats without event bodies. */
  includeDebugEvents?: boolean;
  /** SyncDB: entity limit per collection. */
  limit?: number;
}

/** Which client data layer `get_client_state` found in the running app. */
type ClientStateLayer = "rtk" | "syncdb" | "syncdb+rtk" | "none";

type RtkStateProbe = {found: true; state: unknown} | {found: false; reason: string};

const STORE_READ_EXPR = `(() => {
  const s = globalThis.__TERRENO_STORE__;
  if (!s || typeof s.getState !== "function") {
    return { ok: false, error: "no __TERRENO_STORE__" };
  }
  try {
    return { ok: true, state: s.getState() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`;

const NO_CLIENT_STATE_HINT =
  "No client data layer found. For RTK Query, call `registerTerrenoDevStore(store)` from @terreno/rtk in __DEV__. For SyncDB, create the client with `createSyncDb({debug: true})`. Keep the app running; when the MCP process cannot see the app heap, start Metro so CDP can reach Hermes (see `connection`).";

const probeRtkState = async (
  slice: string | undefined,
  query: string | undefined
): Promise<RtkStateProbe> => {
  const local = getDevStore();
  if (local) {
    return {found: true, state: summarizeClientState(local.getState(), slice, query)};
  }
  const ev = await cdpRuntimeEvaluate(STORE_READ_EXPR, true);
  if (ev.error) {
    return {found: false, reason: ev.error};
  }
  const payload = ev.value as
    | {error?: string; ok?: boolean; state?: Record<string, unknown>}
    | undefined;
  if (!payload?.ok || !payload.state) {
    return {
      found: false,
      reason: `Could not read store from app: ${JSON.stringify(payload ?? ev.value)}`,
    };
  }
  return {found: true, state: summarizeClientState(payload.state, slice, query)};
};

const resolveLayer = (hasRtk: boolean, hasSyncDb: boolean): ClientStateLayer => {
  if (hasRtk && hasSyncDb) {
    return "syncdb+rtk";
  }
  if (hasSyncDb) {
    return "syncdb";
  }
  if (hasRtk) {
    return "rtk";
  }
  return "none";
};

/**
 * Detects the app's client data layer (RTK Query Redux store and/or SyncDB client) and returns
 * `{layer, rtk?, syncdb?}`, or `{layer: "none", hint, reasons, connection}` when neither is found.
 */
export const getClientState = async (args: GetClientStateArgs): Promise<string> => {
  const hasLocalRtk = getDevStore() !== undefined;
  const hasLocalSyncDb = hasLocalSyncDbRegistry();
  // An in-process registry means the app shares this heap, so CDP would only add latency.
  const isInProcess = hasLocalRtk || hasLocalSyncDb;
  const [rtk, syncdb] = await Promise.all([
    isInProcess && !hasLocalRtk
      ? Promise.resolve<RtkStateProbe>({found: false, reason: "no __TERRENO_STORE__ in process"})
      : probeRtkState(args.slice?.trim(), args.query?.trim()),
    isInProcess && !hasLocalSyncDb
      ? Promise.resolve<SyncDbStateProbe>({
          found: false,
          reason: "no __TERRENO_SYNCDB__ registry in process",
        })
      : probeSyncDbState({
          collection: args.collection,
          entityId: args.entityId,
          includeDebugEvents: args.includeDebugEvents,
          limit: args.limit,
          name: args.name,
        }),
  ]);
  const layer = resolveLayer(rtk.found, syncdb.found);
  if (layer === "none") {
    return JSON.stringify(
      {
        connection: getCdpConnectionStatus(),
        hint: NO_CLIENT_STATE_HINT,
        layer,
        reasons: {
          rtk: rtk.found ? undefined : rtk.reason,
          syncdb: syncdb.found ? undefined : syncdb.reason,
        },
      },
      null,
      2
    );
  }
  return JSON.stringify(
    {
      layer,
      rtk: rtk.found ? rtk.state : undefined,
      syncdb: syncdb.found ? syncdb.state : undefined,
    },
    null,
    2
  );
};

export interface EvaluateArgs {
  code: string;
}

export const evaluate = (args: EvaluateArgs): Promise<string> => {
  return (async (): Promise<string> => {
    if (process.env.TERRENO_MCP_EVAL !== "1" && process.env.TERRENO_MCP_EVAL !== "true") {
      return "Refused: set `TERRENO_MCP_EVAL=1` to opt in to `Runtime.evaluate` (arbitrary JS in the app runtime).";
    }
    const trimmed = args.code.trim();
    if (!trimmed) {
      return "No code provided.";
    }
    const ev = await cdpRuntimeEvaluate(trimmed, true);
    if (ev.error) {
      return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
    }
    return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
  })();
};

export interface NavigateArgs {
  path: string;
}

const buildNavigateExpr = (path: string): string => {
  const enc = JSON.stringify(path);
  return `(() => {
  try {
    const expoRouter = require("expo-router");
    const r = expoRouter.router;
    if (r && typeof r.navigate === "function") {
      r.navigate(${enc});
      return { ok: true, method: "navigate" };
    }
    if (r && typeof r.push === "function") {
      r.push(${enc});
      return { ok: true, method: "push" };
    }
    return { ok: false, error: "expo-router router has no navigate/push" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`;
};

export const navigate = (args: NavigateArgs): Promise<string> => {
  return (async (): Promise<string> => {
    if (process.env.TERRENO_MCP_EVAL !== "1" && process.env.TERRENO_MCP_EVAL !== "true") {
      return "Refused: set `TERRENO_MCP_EVAL=1` to opt in to CDP-driven navigation (runs a fixed expo-router snippet in the app).";
    }
    const path = args.path.trim();
    if (!path) {
      return "No path provided.";
    }
    await ensureCdpConnected();
    const ev = await cdpRuntimeEvaluate(buildNavigateExpr(path), true);
    if (ev.error) {
      return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
    }
    return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
  })();
};
