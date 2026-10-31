/**
 * What `createBetterAuthClient` records about each client it makes (web bearer mode, storage), and
 * the reads built on it. Kept apart from betterAuthClient.ts, which loads the Expo plugin and other
 * native modules, so the Redux slice can ask how a client authenticates without loading them.
 */
import type {BetterAuthBearerStorage, BetterAuthWebAuth} from "./betterAuthTypes";

/** @internal Storage key prefix when `createBetterAuthClient` is given none. */
export const DEFAULT_STORAGE_PREFIX = "terreno";

// Signed-out fallback for environments with no usable localStorage (SSR, blocked storage).
const NO_BEARER_STORAGE: BetterAuthBearerStorage = {
  getItem: () => null,
  removeItem: () => {},
  setItem: () => {},
};

/** @internal */
export const resolveBearerStorage = (
  bearerStorage?: BetterAuthBearerStorage
): BetterAuthBearerStorage => {
  if (bearerStorage) {
    return bearerStorage;
  }
  if (typeof window === "undefined") {
    return NO_BEARER_STORAGE;
  }
  try {
    // Reading `window.localStorage` throws when the browser blocks site storage.
    return window.localStorage ?? NO_BEARER_STORAGE;
  } catch {
    return NO_BEARER_STORAGE;
  }
};

/** @internal */
export const bearerTokenKey = (storagePrefix?: string): string => {
  return `${storagePrefix ?? DEFAULT_STORAGE_PREFIX}_bearer_token`;
};

/**
 * Reads the bearer token that `createBetterAuthClient({webAuth: "bearer"})` stored, without a
 * network call. Pass the same `storagePrefix` and `bearerStorage` the client was created with.
 * Returns `null` when signed out or when no storage is available.
 *
 * @example
 * ```typescript
 * const token = getBetterAuthBearerToken({storagePrefix: "myapp"});
 * ```
 */
export const getBetterAuthBearerToken = ({
  bearerStorage,
  storagePrefix,
}: {
  bearerStorage?: BetterAuthBearerStorage;
  storagePrefix?: string;
} = {}): string | null => {
  return resolveBearerStorage(bearerStorage).getItem(bearerTokenKey(storagePrefix));
};

/**
 * How a client `createBetterAuthClient` made authenticates on web, and, in bearer mode, the token
 * it holds. Returns `{webAuth: "cookie", bearerToken: null}` on native (the Expo plugin keeps the
 * session there), in cookie mode, and for a client this factory did not make. Makes no request.
 *
 * @example
 * ```typescript
 * const {webAuth, bearerToken} = getBetterAuthClientWebAuth(authClient);
 * ```
 */
export const getBetterAuthClientWebAuth = (
  client: object
): {webAuth: BetterAuthWebAuth; bearerToken: string | null} => {
  const config = handoffClients.get(client);
  if (!config?.isWebBearer) {
    return {bearerToken: null, webAuth: "cookie"};
  }
  return {
    bearerToken: getBetterAuthBearerToken({
      bearerStorage: config.bearerStorage,
      storagePrefix: config.storagePrefix,
    }),
    webAuth: "bearer",
  };
};

/** What the OAuth handoff needs to know about a client `createBetterAuthClient` made. */
export interface HandoffClientConfig {
  /** Better Auth's base URL with its path, as the client resolved it, without a trailing slash. */
  authBaseURL: string;
  bearerStorage?: BetterAuthBearerStorage;
  isWebBearer: boolean;
  storagePrefix: string;
}

// Keyed by the client itself: Better Auth's client is a route proxy, so nothing can be added to
// it, and bearer mode only exists on clients this factory made.
/** @internal */
export const handoffClients = new WeakMap<object, HandoffClientConfig>();
