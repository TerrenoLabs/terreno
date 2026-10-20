/**
 * Better Auth client factory for React Native/Expo applications.
 *
 * Provides a configured Better Auth client with Expo-specific storage
 * and deep linking support.
 */

import {expoClient} from "@better-auth/expo/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {BetterAuthClientPlugin} from "better-auth/client";
import {createAuthClient} from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import type {BetterAuthBearerStorage, BetterAuthClientConfig} from "./betterAuthTypes";
import {IsWeb} from "./platform";

// Re-export types for convenience
export type {
  BetterAuthBearerStorage,
  BetterAuthClientConfig,
  BetterAuthOAuthProvider,
  BetterAuthSession,
  BetterAuthSessionData,
  BetterAuthUser,
} from "./betterAuthTypes";

/**
 * Storage adapter interface matching what Better Auth expects.
 */
export interface StorageAdapter {
  setItem: (key: string, value: string) => void | Promise<void>;
  getItem: (key: string) => string | null | Promise<string | null>;
  removeItem?: (key: string) => void | Promise<void>;
}

type ExpoClientStorage = NonNullable<Parameters<typeof expoClient>[0]["storage"]>;

/**
 * Storage adapter for Better Auth that works on both web and native.
 * Uses SecureStore on native platforms and AsyncStorage on web.
 *
 * The native branch must be **synchronous**: `@better-auth/expo`'s client plugin reads the
 * cookie jar inline (`getCookie(storage.getItem(name) || "{}")` followed by `JSON.parse`)
 * while building request headers, and it sets `credentials: "omit"` on native so that
 * stored jar is the only way a session token reaches the server. A promise-returning
 * `getItem` fails the parse, yielding an empty jar and unauthenticated requests.
 * `expo-secure-store` exposes sync `getItem`/`setItem` alongside the `*Async` variants.
 *
 * The web branch stays async: the plugin short-circuits on web (`if (isWeb) return`) and
 * lets the browser manage cookies, so it never reads this adapter there.
 *
 * `isWeb` is exposed as a parameter so the adapter can be unit tested
 * without having to re-load the module for each platform.
 */
export const createStorageAdapter = (isWeb: boolean = IsWeb): StorageAdapter => {
  if (isWeb) {
    return {
      getItem: (key: string): Promise<string | null> => {
        if (typeof window !== "undefined") {
          return AsyncStorage.getItem(key);
        }
        return Promise.resolve(null);
      },
      removeItem: (key: string): Promise<void> => {
        if (typeof window !== "undefined") {
          return AsyncStorage.removeItem(key);
        }
        return Promise.resolve();
      },
      setItem: (key: string, value: string): Promise<void> => {
        if (typeof window !== "undefined") {
          return AsyncStorage.setItem(key, value);
        }
        return Promise.resolve();
      },
    };
  }

  // Native platform - use SecureStore's synchronous API (see note above).
  return {
    getItem: (key: string) => SecureStore.getItem(key),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItem(key, value),
  };
};

const DEFAULT_STORAGE_PREFIX = "terreno";

/**
 * Drops cookie-jar entries that `@better-auth/expo` cannot read.
 *
 * The plugin keeps its jar as `{[name]: {value, expires}}` and reads it with
 * `Object.entries(jar).reduce((acc, [name, cookie]) => cookie.expires ? ... )`. That property
 * access throws on any entry whose value is not an object, and it runs inside the plugin's
 * `init()` hook, ahead of *every* native request. One malformed entry therefore makes all
 * requests throw before a socket is opened - sign-in included, so the app can never write a
 * good jar over the bad one and stays permanently unable to reach the API. Discarding the
 * unreadable entries degrades to "signed out", which signing in again recovers from.
 */
export const repairCookieJar = (stored: string | null): string | null => {
  if (!stored) {
    return stored;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // The plugin already tolerates unparseable jars by falling back to an empty one.
    return stored;
  }

  // A non-object jar (including the literal `null`) makes the plugin's `Object.entries` throw.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const entries = Object.entries(parsed);
  const readable = entries.filter(([, cookie]) => typeof cookie === "object" && cookie !== null);
  if (readable.length === entries.length) {
    return stored;
  }

  console.warn(
    `[terreno/rtk] Discarded ${entries.length - readable.length} unreadable Better Auth cookie ` +
      "entry/entries; sign in again to restore the session."
  );
  return JSON.stringify(Object.fromEntries(readable));
};

/**
 * Wraps a storage adapter so reads of the Better Auth cookie jar are repaired first. Only the
 * jar key is touched, because the plugin stores unrelated shapes under its other keys (the
 * cached session payload holds plain strings and numbers, which `repairCookieJar` would strip).
 */
export const withCookieJarRepair = ({
  cookieJarKey,
  storage,
}: {
  cookieJarKey: string;
  storage: StorageAdapter;
}): StorageAdapter => ({
  ...storage,
  getItem: (key: string): string | null | Promise<string | null> => {
    const stored = storage.getItem(key);
    if (key !== cookieJarKey) {
      return stored;
    }
    if (stored instanceof Promise) {
      return stored.then(repairCookieJar);
    }
    return repairCookieJar(stored);
  },
});

type BetterAuthFetchOptions = NonNullable<
  NonNullable<Parameters<typeof createAuthClient>[0]>["fetchOptions"]
>;
type BetterAuthRequestHook = NonNullable<BetterAuthFetchOptions["onRequest"]>;
type BetterAuthSuccessHook = NonNullable<BetterAuthFetchOptions["onSuccess"]>;

// Signed-out fallback for environments with no usable localStorage (SSR, blocked storage).
const NO_BEARER_STORAGE: BetterAuthBearerStorage = {
  getItem: () => null,
  removeItem: () => {},
  setItem: () => {},
};

const resolveBearerStorage = (bearerStorage?: BetterAuthBearerStorage): BetterAuthBearerStorage => {
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

const bearerTokenKey = (storagePrefix?: string): string => {
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

const isAuthEndpoint = (url: string | URL, endpoint: string): boolean => {
  return new URL(url.toString(), "http://localhost").pathname.endsWith(endpoint);
};

const sentBearerToken = (headers: Headers): string | null => {
  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
};

/**
 * better-fetch options that authenticate every Better Auth call with a stored bearer token and
 * no cookies. They are client-wide defaults: per-call hooks still run alongside them, but a
 * per-call `auth` or `credentials` overrides them.
 */
const createWebBearerFetchOptions = ({
  bearerStorage,
  storagePrefix,
}: {
  bearerStorage?: BetterAuthBearerStorage;
  storagePrefix?: string;
}): BetterAuthFetchOptions => {
  // Resolved per access so a client created before `window` exists (SSR) still finds storage.
  const storage = (): BetterAuthBearerStorage => resolveBearerStorage(bearerStorage);
  const tokenKey = bearerTokenKey(storagePrefix);
  const readToken = (): string | null => storage().getItem(tokenKey);

  // Counts sign-outs, so a token issued by a request that was in flight across one is dropped.
  let signOutCount = 0;
  const signOutCountAtRequest = new WeakMap<object, number>();

  // Runs after the request headers are built and before fetch, so the sign-out request still
  // carries the token for the server to revoke while the device forgets it whatever happens next.
  const onRequest: BetterAuthRequestHook = (context) => {
    if (isAuthEndpoint(context.url, "/sign-out")) {
      signOutCount += 1;
      storage().removeItem(tokenKey);
    }
    signOutCountAtRequest.set(context, signOutCount);
  };

  // Only 2xx responses reach onSuccess, so a failed or 5xx get-session never clears the token.
  const onSuccess: BetterAuthSuccessHook = (context) => {
    const issuedToken = context.response.headers.get("set-auth-token");
    if (issuedToken) {
      // better-fetch hands onSuccess the same context object that onRequest saw.
      const countAtRequest = signOutCountAtRequest.get(context.request) ?? signOutCount;
      if (countAtRequest === signOutCount) {
        storage().setItem(tokenKey, issuedToken);
      }
      return;
    }
    if (!isAuthEndpoint(context.request.url, "/get-session")) {
      return;
    }
    if ((context.data as {session?: unknown} | null)?.session) {
      return;
    }
    // The server rejected the token this request sent. A token stored while it was in flight
    // (a sign-in that finished first) is newer and must survive.
    if (sentBearerToken(context.request.headers) === readToken()) {
      storage().removeItem(tokenKey);
    }
  };

  return {
    auth: {token: (): string | undefined => readToken() ?? undefined, type: "Bearer"},
    credentials: "omit",
    onRequest,
    onSuccess,
  };
};

/**
 * Creates a Better Auth client configured for Expo/React Native.
 *
 * Pass `webAuth: "bearer"` when the web frontend and the API are on different sites: the web
 * client then authenticates with a stored bearer token instead of cookies. Read that token
 * elsewhere with `getBetterAuthBearerToken`.
 *
 * @example
 * ```typescript
 * const authClient = createBetterAuthClient({
 *   baseURL: "http://localhost:3000",
 *   scheme: "terreno",
 * });
 *
 * // Use for social login
 * await authClient.signIn.social({
 *   provider: "google",
 * });
 *
 * // Get current session
 * const session = await authClient.getSession();
 * ```
 */
export const createBetterAuthClient = (config: BetterAuthClientConfig) => {
  const storagePrefix = config.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
  // Mirrors the plugin's own `cookieName = `${storagePrefix}_cookie``.
  const storage = withCookieJarRepair({
    cookieJarKey: `${storagePrefix}_cookie`,
    storage: createStorageAdapter(),
  });

  // `expoClient` declares `getActions` against a narrowed `BetterFetch<CreateFetchOption, ...>`
  // while `BetterAuthClientPlugin` declares the unparameterized `BetterFetch`, so the plugin
  // does not structurally satisfy its own contract. Runtime behaviour is unaffected.
  const expoAuthPlugin = expoClient({
    scheme: config.scheme,
    // The plugin's storage type is strictly sync (`getItem: (key) => string | null`),
    // which the native branch satisfies. The union-typed web branch is async but
    // unreachable here, since the plugin skips storage entirely on web.
    storage: storage as unknown as ExpoClientStorage,
    storagePrefix,
  }) as unknown as BetterAuthClientPlugin;

  // Native and cookie mode pass exactly the options they always have.
  const isWebBearer = IsWeb && config.webAuth === "bearer";

  return createAuthClient({
    baseURL: config.baseURL,
    plugins: [expoAuthPlugin],
    ...(isWebBearer
      ? {
          fetchOptions: createWebBearerFetchOptions({
            bearerStorage: config.bearerStorage,
            storagePrefix,
          }),
        }
      : {}),
  });
};

/**
 * Type of the Better Auth client returned by createBetterAuthClient.
 */
export type BetterAuthClient = ReturnType<typeof createBetterAuthClient>;
