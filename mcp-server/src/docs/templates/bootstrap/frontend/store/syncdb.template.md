import {
  betterAuthAdapter,
  bridgeBetterAuthReactClient,
  createSyncDb,
  type SyncDb,
} from "@terreno/syncdb";
import {baseUrl} from "@terreno/syncdb/config";
import {betterAuthClient} from "@/lib/betterAuth";

export const SYNC_DB_NAME = "{{appName}}";

/** Add synced collection names here as you register modelRouter sync scopes on the backend. */
export const SYNC_COLLECTIONS: string[] = [];

/**
 * Shared by the sync client and the request client (store/apiClient.ts) so both send the same
 * Better Auth session token and refresh the same way. bridgeBetterAuthReactClient turns the
 * Better Auth session atom into push updates; pollIntervalMs is only a fallback if that atom
 * is unavailable, so keep it slow.
 */
export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient), {
  pollIntervalMs: 60_000,
});

export const syncDb: SyncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: SYNC_COLLECTIONS,
  name: SYNC_DB_NAME,
});

/**
 * Tracks whether `syncDb.start()` has resolved for the current login. Screens gate
 * `mutate()` on it: `start()` must resolve an authenticated user before writes are safe.
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
