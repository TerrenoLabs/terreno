/**
 * @terreno/syncdb client for the example app.
 *
 * Authenticates with the Better Auth session from `lib/betterAuth.ts`. The same `authProvider`
 * feeds the request client (store/apiClient.ts), so sync and request traffic share one session.
 */
import {
  betterAuthAdapter,
  bridgeBetterAuthReactClient,
  createSyncDb,
  type SyncDb,
} from "@terreno/syncdb";
import {baseUrl} from "@terreno/syncdb/config";
import {bearerAuthHeaders} from "@/lib/authHeaders";
import {betterAuthClient, getStoredBearerToken} from "@/lib/betterAuth";
import {SYNC_COLLECTIONS} from "@/store/syncDbSdk";

export const SYNC_DB_NAME = "terreno-example";
/** Admin window rows live in their own store so they never leak into the product UI. */
const ADMIN_SYNC_DB_NAME = `${SYNC_DB_NAME}-admin`;

/** Collection tags for the AI screen's chat list and the MCP settings token list. */
export const GPT_HISTORIES_COLLECTION = "gpt/histories";
export const MCP_SERVICE_TOKENS_COLLECTION = "mcp/service-tokens";

/**
 * Owner-only collections with no `adminBroadcast`: the admin window store never opens them,
 * and the server has no admin window stream for them.
 */
const PRODUCT_ONLY_COLLECTIONS: ReadonlySet<string> = new Set([
  GPT_HISTORIES_COLLECTION,
  MCP_SERVICE_TOKENS_COLLECTION,
]);
const ADMIN_COLLECTIONS = SYNC_COLLECTIONS.filter(
  (collection) => !PRODUCT_ONLY_COLLECTIONS.has(collection)
);

/**
 * The app's one token source, shared by the sync client and the API client
 * (store/apiClient.ts) so both send the same Better Auth session token.
 *
 * `getBearerToken` reads the web bearer token locally, so `getToken()` makes no `get-session`
 * call per read; it returns null in cookie mode and on native, where the adapter reads the
 * session instead. pollIntervalMs is only used as a fallback if the session atom bridge is
 * unavailable (e.g. a future Better Auth client shape change); keep it slow.
 */
export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient), {
  getBearerToken: getStoredBearerToken,
  pollIntervalMs: 60_000,
});

/**
 * `Authorization` header for code that calls the backend outside the request client
 * (`AdminProvider`'s fetch client on the admin and documents screens).
 */
export const getAdminAuthHeaders = (): Promise<Record<string, string>> =>
  bearerAuthHeaders(authProvider.getToken);

/**
 * Singleton local-first client. Started/stopped by the root layout when the user is
 * authenticated; wipe-on-user-change is handled internally.
 *
 * `debug` enables the in-memory sync event log in dev builds only. It powers the
 * `/syncdb-debug` screen and registers this client for terreno-mcp-local state,
 * action, and snapshot tools. It is off in production so there is zero recording
 * or MCP bridge overhead.
 */
export const syncDb: SyncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: [...SYNC_COLLECTIONS],
  debug: __DEV__ ? {capacity: 1000} : false,
  // haltQueueOnConflict: true — the example app is a template other apps grow
  // from, and it's common to add cross-collection references (e.g. a todo
  // referencing a project id) as the schema grows. The default per-entity
  // conflict policy already blocks a queued mutation whose args reference a
  // currently-blocked entity's id (see the syncdb README "Cross-collection
  // reference blocking"), but that only covers references present in `args`;
  // opting into a whole-drain halt here is the stronger, simpler guarantee
  // for a starter app whose data model isn't fixed yet. Flip to `false` (the
  // package default) once your entities are truly independent and you want a
  // conflict on one to never stall unrelated ones.
  haltQueueOnConflict: true,
  name: SYNC_DB_NAME,
  // Todos stay fully synced; `fullSync` also enables server-filtered query windows
  // (`useWindowQuery`) over GET /todos — see app/todo-windows.tsx.
  queryCollections: [{collection: "todos", fullSync: true}],
  // An explicit logout (useSession().logout) signs this client out; wipe the signed-out user's
  // local rows and queued writes so they never reach the next account on this device.
  wipeOnSignOut: true,
});

let adminOrganizationId: string | undefined;

/** Bind the admin window client's mutate payloads to the selected organization. */
export const setAdminSyncOrganizationId = (organizationId?: string): void => {
  adminOrganizationId = organizationId;
};

/**
 * Admin windows use a separate store/socket so `{collection}|admin` rows never
 * enter the owner-scoped product store for the same collection.
 */
export const adminSyncDb: SyncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: [...ADMIN_COLLECTIONS],
  name: ADMIN_SYNC_DB_NAME,
  organizationIdProvider: () => adminOrganizationId,
  windowCollections: [...ADMIN_COLLECTIONS],
  wipeOnSignOut: true,
});

/**
 * Tracks whether `syncDb.start()` has resolved for the current login. `start()` is
 * fired from the root layout as soon as `userId` is set, but it awaits the auth
 * provider resolving a user id before `mutate()` becomes safe to call — without this
 * flag, screens can render (and users/tests can click "create") during that window,
 * and `client.mutate()` throws "requires start() to have resolved an authenticated
 * user". Module-level (not React state) so both the root layout, which flips it, and
 * any screen calling `useSyncDbReady()`, which reads it, share one source of truth.
 */
let syncDbReady = false;
const syncDbReadyListeners = new Set<() => void>();

export const setSyncDbReady = (ready: boolean): void => {
  if (syncDbReady === ready) {
    return;
  }
  syncDbReady = ready;
  for (const listener of syncDbReadyListeners) {
    listener();
  }
};

export const subscribeSyncDbReady = (listener: () => void): (() => void) => {
  syncDbReadyListeners.add(listener);
  return () => {
    syncDbReadyListeners.delete(listener);
  };
};

export const getSyncDbReadySnapshot = (): boolean => syncDbReady;
