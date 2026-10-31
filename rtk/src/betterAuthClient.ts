/**
 * Better Auth client factory for React Native/Expo applications.
 *
 * Provides a configured Better Auth client with Expo-specific storage
 * and deep linking support.
 */

import {expoClient} from "@better-auth/expo/client";
import {passkeyClient} from "@better-auth/passkey/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {BetterAuthClientPlugin} from "better-auth/client";
import {
  lastLoginMethodClient,
  multiSessionClient,
  oneTimeTokenClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import {createAuthClient, type ReactAuthClient} from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import {
  bearerTokenKey,
  DEFAULT_STORAGE_PREFIX,
  getBetterAuthBearerToken,
  type HandoffClientConfig,
  handoffClients,
  resolveBearerStorage,
} from "./betterAuthClientRegistry";
import type {
  BetterAuthBearerStorage,
  BetterAuthClientConfig,
  BetterAuthClientFeatures,
} from "./betterAuthTypes";
import {IsWeb} from "./platform";

export {getBetterAuthBearerToken, getBetterAuthClientWebAuth} from "./betterAuthClientRegistry";

// Re-export types for convenience
export type {
  BetterAuthBearerStorage,
  BetterAuthClientConfig,
  BetterAuthClientFeatures,
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
type BetterAuthResponseHook = NonNullable<BetterAuthFetchOptions["onResponse"]>;

const isAuthEndpoint = (url: string | URL, endpoint: string): boolean => {
  return new URL(url.toString(), "http://localhost").pathname.endsWith(endpoint);
};

/**
 * The header `@terreno/api` uses to carry Better Auth's signed challenge cookies (two-factor,
 * trust-device, passkey) to and from clients that send no cookies.
 */
const AUTH_CHALLENGE_HEADER = "X-Terreno-Auth-Challenge";

// Sent when nothing is held, so the server still knows to answer with the header.
const AUTH_CHALLENGE_EMPTY = "-";

// Better Auth paths whose requests read challenge cookies (a trusted device is checked at sign-in).
const AUTH_CHALLENGE_PATHS = ["/two-factor/", "/passkey/", "/sign-in/"];

// Successful calls to these end the two-factor challenge.
const TWO_FACTOR_VERIFY_PATHS = [
  "/two-factor/verify-totp",
  "/two-factor/verify-otp",
  "/two-factor/verify-backup-code",
];

const authChallengeKey = (storagePrefix?: string): string => {
  return `${storagePrefix ?? DEFAULT_STORAGE_PREFIX}_auth_challenge`;
};

const isChallengeEndpoint = (url: string | URL): boolean => {
  const {pathname} = new URL(url.toString(), "http://localhost");
  return AUTH_CHALLENGE_PATHS.some((path) => pathname.includes(path));
};

// Cookie names carry Better Auth's prefix (`better-auth.trust_device`, maybe `__Secure-`).
const isCookieNamed = (name: string, cookie: string): boolean => {
  return name === cookie || name.endsWith(`.${cookie}`);
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

  // The challenge cookies the server handed over, as `name=value` pairs, beside the bearer.
  const challengeKey = authChallengeKey(storagePrefix);
  const readChallenge = (): URLSearchParams => {
    const stored = storage().getItem(challengeKey);
    return new URLSearchParams(stored && stored !== AUTH_CHALLENGE_EMPTY ? stored : "");
  };
  const writeChallenge = (pairs: URLSearchParams): void => {
    if (pairs.size === 0) {
      storage().removeItem(challengeKey);
      return;
    }
    storage().setItem(challengeKey, pairs.toString());
  };
  // Keeps only the entries `keep` accepts.
  const filterChallenge = (keep: (name: string) => boolean): void => {
    const pairs = readChallenge();
    for (const name of Array.from(pairs.keys())) {
      if (!keep(name)) {
        pairs.delete(name);
      }
    }
    writeChallenge(pairs);
  };

  // Counts sign-outs, so a token issued by a request that was in flight across one is dropped.
  let signOutCount = 0;
  const signOutCountAtRequest = new WeakMap<object, number>();

  // Runs after the request headers are built and before fetch, so the sign-out request still
  // carries the token for the server to revoke while the device forgets it whatever happens next.
  // Challenge calls carry the held challenge cookies; nothing else ever sees them.
  const onRequest: BetterAuthRequestHook = (context) => {
    if (isAuthEndpoint(context.url, "/sign-out")) {
      signOutCount += 1;
      storage().removeItem(tokenKey);
      // A trusted device stays trusted across sign-outs; pending challenges do not.
      filterChallenge((name) => isCookieNamed(name, "trust_device"));
    }
    signOutCountAtRequest.set(context, signOutCount);
    if (isChallengeEndpoint(context.url)) {
      const held = readChallenge();
      context.headers.set(
        AUTH_CHALLENGE_HEADER,
        held.size > 0 ? held.toString() : AUTH_CHALLENGE_EMPTY
      );
    }
  };

  // Runs for every status before onSuccess (so before onTwoFactorRedirect), since a refused
  // verify can also expire a challenge. An empty value means the server expired that cookie.
  const onResponse: BetterAuthResponseHook = (context) => {
    const header = context.response.headers.get(AUTH_CHALLENGE_HEADER);
    if (header) {
      const pairs = readChallenge();
      for (const [name, value] of new URLSearchParams(header)) {
        if (value) {
          pairs.set(name, value);
        } else {
          pairs.delete(name);
        }
      }
      writeChallenge(pairs);
    }
    const isVerified =
      context.response.ok &&
      TWO_FACTOR_VERIFY_PATHS.some((path) => isAuthEndpoint(context.request.url, path));
    // The challenge and the sign-in's "don't remember me" belong to the finished sign-in.
    if (isVerified) {
      filterChallenge(
        (name) => !isCookieNamed(name, "two_factor") && !isCookieNamed(name, "dont_remember")
      );
    }
  };

  // Only 2xx responses reach onSuccess, so a failed or 5xx get-session never clears the token.
  const onSuccess: BetterAuthSuccessHook = (context) => {
    const issuedToken = context.response.headers.get("set-auth-token");
    // A sign-in waiting on a second factor has no session yet; any token it carries is dead.
    if ((context.data as {twoFactorRedirect?: boolean} | null)?.twoFactorRedirect) {
      return;
    }
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
    onResponse,
    onSuccess,
  };
};

// Better Auth appends `/api/auth` to a baseURL that has no path of its own.
const resolveAuthBaseURL = (baseURL: string): string => {
  const trimmed = baseURL.replace(/\/+$/, "");
  try {
    if (new URL(baseURL).pathname.replace(/\/+$/, "") !== "") {
      return trimmed;
    }
  } catch {
    // Better Auth rejects such a baseURL itself when the client is created.
  }
  return `${trimmed}/api/auth`;
};

// The client plugin a feature adds when it is on. A feature set to `false`, or left out, adds
// nothing; a widened `boolean` (read from env, say) is typed as on.
type FeaturePlugin<
  Features extends BetterAuthClientFeatures,
  Key extends keyof BetterAuthClientFeatures,
  Plugin,
> = Key extends keyof Features ? ([Features[Key]] extends [false | undefined] ? [] : [Plugin]) : [];

/**
 * The typed client plugins for a `features` object, in the order `createBetterAuthClient`
 * registers them. Better Auth infers each namespace (`client.twoFactor`, `client.passkey`, ...)
 * from this tuple.
 */
export type BetterAuthFeaturePlugins<Features extends BetterAuthClientFeatures> = [
  ...FeaturePlugin<Features, "twoFactor", ReturnType<typeof twoFactorClient>>,
  ...FeaturePlugin<Features, "passkey", ReturnType<typeof passkeyClient>>,
  ...FeaturePlugin<Features, "multiSession", ReturnType<typeof multiSessionClient>>,
  ...FeaturePlugin<Features, "lastLoginMethod", ReturnType<typeof lastLoginMethodClient>>,
  ...FeaturePlugin<Features, "oneTimeToken", ReturnType<typeof oneTimeTokenClient>>,
];

/**
 * Type of the Better Auth client returned by createBetterAuthClient without `features`. Its
 * plugins are typed as a generic list, so plugin namespaces are untyped.
 */
export type BetterAuthClient = ReactAuthClient<{
  baseURL: string;
  fetchOptions?: BetterAuthFetchOptions;
  plugins: BetterAuthClientPlugin[];
}>;

/**
 * Type of the Better Auth client returned by createBetterAuthClient with `features`, such as
 * `BetterAuthClientWithFeatures<{twoFactor: true}>`. Every enabled feature's namespace is typed.
 *
 * The expo plugin is left out of the type: it is typed only as a generic plugin (see
 * createBetterAuthClient), which would widen every namespace to `any`. It adds only `getCookie`.
 */
export type BetterAuthClientWithFeatures<Features extends BetterAuthClientFeatures> =
  ReactAuthClient<{
    baseURL: string;
    fetchOptions?: BetterAuthFetchOptions;
    plugins: BetterAuthFeaturePlugins<Features>;
  }>;

/**
 * What the OAuth handoff helpers need from a client: any client createBetterAuthClient returns,
 * with or without features.
 */
export type BetterAuthHandoffClient = Pick<BetterAuthClient, "$fetch" | "$store">;

/**
 * The client createBetterAuthClient returns for a `features` type. When the features are not
 * known at compile time (no `features`, or a config typed as `BetterAuthClientConfig`), it is
 * `BetterAuthClient`, exactly the client it always returned. When they are written out, every
 * enabled feature's namespace is typed.
 */
export type BetterAuthClientFor<Features extends BetterAuthClientFeatures> =
  BetterAuthClientFeatures extends Features
    ? BetterAuthClient
    : BetterAuthClientWithFeatures<Features>;

/**
 * Builds the client plugins for the enabled features, in BetterAuthFeaturePlugins order. They go
 * after the expo plugin: better-fetch runs plugin hooks in order, so on native the expo plugin
 * stores the 2FA challenge cookie before `onTwoFactorRedirect` runs, and its request hook adds the
 * stored cookies to every feature call.
 */
const createFeaturePlugins = (features?: BetterAuthClientFeatures): BetterAuthClientPlugin[] => {
  if (!features) {
    return [];
  }
  const plugins: BetterAuthClientPlugin[] = [];
  if (features.twoFactor) {
    plugins.push(twoFactorClient(features.twoFactor === true ? undefined : features.twoFactor));
  }
  if (features.passkey) {
    // Same declared-vs-structural mismatch as expoClient below.
    plugins.push(passkeyClient() as unknown as BetterAuthClientPlugin);
  }
  if (features.multiSession) {
    plugins.push(multiSessionClient());
  }
  if (features.lastLoginMethod) {
    plugins.push(lastLoginMethodClient());
  }
  if (features.oneTimeToken) {
    plugins.push(oneTimeTokenClient());
  }
  return plugins;
};

/**
 * Creates a Better Auth client configured for Expo/React Native.
 *
 * Pass `webAuth: "bearer"` when the web frontend and the API are on different sites: the web
 * client then authenticates with a stored bearer token instead of cookies. Read that token
 * elsewhere with `getBetterAuthBearerToken`.
 *
 * Pass `features` to add the client plugins for the Better Auth features the server enables.
 * Each one adds a typed namespace: `client.twoFactor`, `client.passkey`, `client.multiSession`,
 * `client.oneTimeToken`, and `client.getLastUsedLoginMethod`.
 *
 * @example
 * ```typescript
 * const authClient = createBetterAuthClient({
 *   baseURL: "http://localhost:3000",
 *   features: {passkey: true, twoFactor: {onTwoFactorRedirect: () => router.push("/2fa")}},
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
 *
 * // Feature namespaces are typed
 * await authClient.twoFactor.enable({password});
 * ```
 */
export const createBetterAuthClient = <
  const Features extends BetterAuthClientFeatures = BetterAuthClientFeatures,
>(
  config: BetterAuthClientConfig<Features>
): BetterAuthClientFor<Features> => {
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

  const client = createAuthClient({
    baseURL: config.baseURL,
    plugins: [expoAuthPlugin, ...createFeaturePlugins(config.features)],
    ...(isWebBearer
      ? {
          fetchOptions: createWebBearerFetchOptions({
            bearerStorage: config.bearerStorage,
            storagePrefix,
          }),
        }
      : {}),
  });
  handoffClients.set(client, {
    authBaseURL: resolveAuthBaseURL(config.baseURL),
    bearerStorage: config.bearerStorage,
    isWebBearer,
    storagePrefix,
  });
  // The plugins are built at runtime from `features`; BetterAuthClientFor is their type.
  return client as unknown as BetterAuthClientFor<Features>;
};

// URL parameters of the OAuth handoff: T12's server puts the one-time token in the fragment as
// `ott`, and the sign-in's nonce comes back in the callback query as `handoff`.
const HANDOFF_TOKEN_PARAM = "ott";
const HANDOFF_NONCE_PARAM = "handoff";
const HANDOFF_NONCE_BYTES = 32;

const handoffNonceKey = (storagePrefix: string): string => {
  return `${storagePrefix}_oauth_handoff_nonce`;
};

const NOT_WEB_BEARER_MESSAGE =
  'signInSocialWithHandoff needs a web client from createBetterAuthClient({webAuth: "bearer"}). ' +
  "Use authClient.signIn.social on native and in cookie mode.";

const createHandoffNonce = (): string => {
  // A crypto-random nonce only: a guessable one would let a planted token through.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(HANDOFF_NONCE_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Compares every character so the time taken does not depend on where the strings differ.
const nonceMatches = (received: string, stored: string): boolean => {
  if (received.length !== stored.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ stored.charCodeAt(index);
  }
  return difference === 0;
};

const decodeParamPart = (part: string): string | null => {
  try {
    return decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    return null;
  }
};

/**
 * Splits a raw query or fragment (without its `?` or `#`) into the values of `name` and the
 * other parts, kept byte-for-byte so stripping never re-encodes what the app put there.
 */
const takeParam = (raw: string, name: string): {kept: string[]; values: Array<string | null>} => {
  const kept: string[] = [];
  const values: Array<string | null> = [];
  for (const part of raw.split("&")) {
    if (part === "") {
      continue;
    }
    const separator = part.indexOf("=");
    const key = separator === -1 ? part : part.slice(0, separator);
    if (decodeParamPart(key) !== name) {
      kept.push(part);
      continue;
    }
    values.push(separator === -1 ? "" : decodeParamPart(part.slice(separator + 1)));
  }
  return {kept, values};
};

const sessionStorageOrNull = (): BetterAuthBearerStorage | null => {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
};

// Reads and removes the nonce in one step, so each sign-in's nonce is good for one return only.
const takeStoredNonce = (storagePrefix: string): string | null => {
  const storage = sessionStorageOrNull();
  if (!storage) {
    return null;
  }
  try {
    const nonce = storage.getItem(handoffNonceKey(storagePrefix));
    storage.removeItem(handoffNonceKey(storagePrefix));
    return nonce;
  } catch {
    return null;
  }
};

// Appends `handoff=<nonce>` to the query as written, so the app's own parameters reach the
// return page byte-for-byte. Any `handoff` already there is replaced.
const withHandoffNonce = (url: string, nonce: string): string => {
  const parsed = new URL(url, window.location.href);
  const {kept} = takeParam(parsed.search.slice(1), HANDOFF_NONCE_PARAM);
  kept.push(`${HANDOFF_NONCE_PARAM}=${nonce}`);
  return `${parsed.origin}${parsed.pathname}?${kept.join("&")}${parsed.hash}`;
};

/**
 * Starts a social or generic OAuth sign-in for a web client in bearer mode. It stores a random
 * nonce in sessionStorage and navigates the whole page to the server's
 * `GET {basePath}/oauth-handoff/start`, with `handoff=<nonce>` added to `callbackURL` (and to
 * `errorCallbackURL`). A top-level navigation keeps Better Auth's OAuth state cookie
 * first-party on the API's origin. After the provider, the page comes back to `callbackURL`
 * with `#ott=<token>`, and `completeBetterAuthOAuthHandoff` exchanges it for the bearer.
 *
 * `callbackURL` defaults to `/` on the current origin (pass the full path for an app served
 * under a sub-path). It is resolved against the current page, and its path must be one of the
 * server's `oauthHandoff.callbackPaths` (default `["/"]`) on one of its
 * `oauthHandoff.webOrigins`, or the server answers 400. `errorCallbackURL` defaults to
 * `callbackURL`; a failed start or callback comes back there with `?error=`. It is always sent,
 * because without one Better Auth sends callback errors to its own error page on the API.
 *
 * Throws on native, in cookie mode, for a client `createBetterAuthClient` did not make, and
 * when sessionStorage cannot hold the nonce. Use `authClient.signIn.social` in those cases.
 *
 * @example
 * ```typescript
 * <SocialLoginButton
 *   provider="google"
 *   onPress={() => signInSocialWithHandoff({client: authClient, provider: "google"})}
 * />
 * ```
 */
export const signInSocialWithHandoff = ({
  callbackURL = "/",
  client,
  errorCallbackURL,
  provider,
}: {
  callbackURL?: string;
  client: BetterAuthHandoffClient;
  errorCallbackURL?: string;
  provider: string;
}): void => {
  const config = handoffClients.get(client);
  if (!IsWeb || typeof window === "undefined" || !config?.isWebBearer) {
    throw new Error(NOT_WEB_BEARER_MESSAGE);
  }
  const nonce = createHandoffNonce();
  const start = new URL(`${config.authBaseURL}/oauth-handoff/start`);
  start.searchParams.set("provider", provider);
  start.searchParams.set("callbackURL", withHandoffNonce(callbackURL, nonce));
  start.searchParams.set(
    "errorCallbackURL",
    withHandoffNonce(errorCallbackURL ?? callbackURL, nonce)
  );
  // Throws when storage is blocked: without a stored nonce the return would be refused anyway.
  window.sessionStorage.setItem(handoffNonceKey(config.storagePrefix), nonce);
  window.location.assign(start.toString());
};

/**
 * Removes the handoff from the page URL and returns the one-time token when this tab started
 * the sign-in, or null. Runs synchronously, so a second call made before the first finishes
 * finds a clean URL.
 */
const takeHandoffToken = (
  client: BetterAuthHandoffClient
): {config: HandoffClientConfig; token: string} | null => {
  let current: URL;
  try {
    current = new URL(window.location.href);
  } catch {
    return null;
  }
  const query = takeParam(current.search.slice(1), HANDOFF_NONCE_PARAM);
  // The server only puts the token in the fragment. An `ott` in the query was planted: it is
  // removed from the URL with the rest and never sent.
  const queryToken = takeParam(query.kept.join("&"), HANDOFF_TOKEN_PARAM);
  const fragment = takeParam(current.hash.slice(1), HANDOFF_TOKEN_PARAM);
  const hasHandoff =
    query.values.length > 0 || queryToken.values.length > 0 || fragment.values.length > 0;
  if (!hasHandoff) {
    return null;
  }
  const config = handoffClients.get(client);
  const storedNonce = config ? takeStoredNonce(config.storagePrefix) : null;

  // The token leaves the address bar, and so history, before anything else can read or send it.
  const search = queryToken.kept.length > 0 ? `?${queryToken.kept.join("&")}` : "";
  const hash = fragment.kept.length > 0 ? `#${fragment.kept.join("&")}` : "";
  try {
    window.history.replaceState(window.history.state, "", `${current.pathname}${search}${hash}`);
  } catch (error) {
    console.warn("[terreno/rtk] Could not remove the OAuth handoff from the URL; not verifying", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }

  if (!config?.isWebBearer || fragment.values.length !== 1 || query.values.length !== 1) {
    return null;
  }
  const [token] = fragment.values;
  const [receivedNonce] = query.values;
  // A token without the nonce this tab stored was planted, so it is never sent.
  if (!token || !receivedNonce || !storedNonce || !nonceMatches(receivedNonce, storedNonce)) {
    return null;
  }
  return {config, token};
};

const verifyHandoffToken = async ({
  client,
  config,
  token,
}: {
  client: BetterAuthHandoffClient;
  config: HandoffClientConfig;
  token: string;
}): Promise<boolean> => {
  let issuedToken: string | null = null;
  try {
    // Through the client, so bearer mode's hooks store the token and apply the sign-out guard.
    const result = await client.$fetch("/one-time-token/verify", {
      body: {token},
      method: "POST",
      onSuccess: (context): void => {
        issuedToken = context.response.headers.get("set-auth-token");
      },
    });
    if (result.error) {
      console.warn("[terreno/rtk] OAuth handoff verify was refused", {
        status: result.error.status,
      });
      return false;
    }
    if (!issuedToken) {
      return false;
    }
    const stored = getBetterAuthBearerToken({
      bearerStorage: config.bearerStorage,
      storagePrefix: config.storagePrefix,
    });
    if (stored !== issuedToken) {
      return false;
    }
  } catch (error) {
    console.warn("[terreno/rtk] OAuth handoff verify failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
  // `$fetch` skips the session signal that the client's own routes send, so a mounted
  // `useSession` refetches with the new token.
  client.$store?.notify("$sessionSignal");
  return true;
};

const pendingHandoffs = new WeakMap<object, Promise<boolean>>();

/**
 * Finishes a sign-in that `signInSocialWithHandoff` started, on the page the provider sent the
 * browser back to. Await it once at startup, before anything reads the session, before any code
 * acts on other query parameters, and before Sentry or analytics start.
 *
 * When the URL has `#ott=<token>` and `?handoff=` equal to the nonce this tab stored, it removes
 * `ott`, `handoff` and the stored nonce (`history.replaceState`), then exchanges the token at
 * `POST {basePath}/one-time-token/verify`. Bearer mode stores the `set-auth-token` that comes
 * back. Other query and fragment parts are kept. A token without a matching nonce, or an `ott`
 * in the query (the server only uses the fragment), is removed from the URL and never sent. Native, cookie mode, and a page without `ott` make no request.
 *
 * Resolves `true` only when a bearer token was stored, and never rejects. A return with
 * `?error=` (such as `provider_not_found` or `sign_in_failed`) resolves `false` and leaves the
 * error in the URL for the app to show. Calls made while one is running share its result.
 *
 * @example
 * ```typescript
 * await completeBetterAuthOAuthHandoff({client: authClient});
 * await betterAuth.syncSession(store.dispatch);
 * ```
 */
export const completeBetterAuthOAuthHandoff = ({
  client,
}: {
  client: BetterAuthHandoffClient;
}): Promise<boolean> => {
  if (!IsWeb || typeof window === "undefined") {
    return Promise.resolve(false);
  }
  const pending = pendingHandoffs.get(client);
  if (pending !== undefined) {
    return pending;
  }
  const handoff = takeHandoffToken(client);
  if (!handoff) {
    return Promise.resolve(false);
  }
  const result = verifyHandoffToken({client, ...handoff}).finally(() => {
    pendingHandoffs.delete(client);
  });
  pendingHandoffs.set(client, result);
  return result;
};

/** The part of a typed client (one made with `features`) that linking calls. */
interface LinkSocialClient extends Pick<BetterAuthClient, "$fetch"> {
  // Method syntax, so each client's own `linkSocial` (whose `provider` may be a narrower union)
  // still fits.
  linkSocial(body: {
    callbackURL: string;
    errorCallbackURL?: string;
    provider: string;
  }): Promise<{error: {code?: string; message?: string; status: number} | null}>;
}

/**
 * What linking needs from a client: any client createBetterAuthClient returns, with or without
 * features. A client without `features` is typed loosely, so it is listed on its own.
 */
export type BetterAuthLinkClient = BetterAuthClient | LinkSocialClient;

/** Why a link could not start; `null` when the browser is on its way to the provider. */
export interface LinkSocialWithHandoffResult {
  error: {code?: string; message?: string; status: number} | null;
}

interface LinkIntentResponse {
  startURL: string;
  token: string;
}

const toLinkError = (error: {
  code?: string;
  message?: string;
  status: number;
}): NonNullable<LinkSocialWithHandoffResult["error"]> => ({
  status: error.status,
  ...(error.code !== undefined ? {code: error.code} : {}),
  ...(error.message !== undefined ? {message: error.message} : {}),
});

const isHttpURL = (url: unknown): url is string => {
  if (typeof url !== "string") {
    return false;
  }
  try {
    const {protocol} = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

// Posts the token from a hidden form, a top-level navigation, so the token stays out of the
// page URL, history, and access logs, and the API sets the state cookie first-party.
const submitLinkForm = (startURL: string, token: string): void => {
  const form = window.document.createElement("form");
  form.method = "POST";
  form.action = startURL;
  form.style.display = "none";
  const field = window.document.createElement("input");
  field.type = "hidden";
  field.name = "token";
  field.value = token;
  form.appendChild(field);
  window.document.body.appendChild(form);
  form.submit();
};

/**
 * Links a social or generic OAuth provider to the signed-in user.
 *
 * On web in bearer mode (`createBetterAuthClient({webAuth: "bearer"})`), a `POST /link-social`
 * fetch from another site cannot set Better Auth's OAuth state cookie on the API's origin. So
 * this posts `{provider, callbackURL, errorCallbackURL}` to the server's
 * `POST {basePath}/oauth-handoff/link-intent` with the bearer, then submits the single-use token
 * it returns in a hidden form (method POST) to `startURL`, which redirects the page to the
 * provider. The provider sends the page back to `callbackURL`, with no token: linking creates no
 * session. A failure after the form comes back to `errorCallbackURL` with `?error=`.
 *
 * Both URLs are resolved against the current page and may be any page on one of the server's
 * `oauthHandoff.webOrigins` that its `trustedOrigins` allows. `oauthHandoff.callbackPaths` do not
 * apply, since no token travels on a link's return. `errorCallbackURL` defaults to
 * `callbackURL`. The page must not be served with `Referrer-Policy: no-referrer` or
 * `same-origin`: the form's `Origin` header is then `null`, and the server refuses the start.
 *
 * In cookie mode and on native it calls `client.linkSocial` as before.
 *
 * Resolves `{error: null}` once the browser is on its way (or `linkSocial` succeeded), and
 * `{error}` when the server refused, such as 403 `LINKING_DISABLED` when linking is off. It never
 * submits the form after a refusal.
 *
 * @example
 * ```typescript
 * const {error} = await linkSocialWithHandoff({
 *   callbackURL: "/settings/security",
 *   client: authClient,
 *   errorCallbackURL: "/settings/security",
 *   provider: "google",
 * });
 * ```
 */
export const linkSocialWithHandoff = async ({
  callbackURL,
  client,
  errorCallbackURL,
  provider,
}: {
  callbackURL: string;
  client: BetterAuthLinkClient;
  errorCallbackURL?: string;
  provider: string;
}): Promise<LinkSocialWithHandoffResult> => {
  const config = handoffClients.get(client);
  if (!IsWeb || typeof window === "undefined" || !config?.isWebBearer) {
    const result = await (client as LinkSocialClient).linkSocial({
      callbackURL,
      provider,
      ...(errorCallbackURL !== undefined ? {errorCallbackURL} : {}),
    });
    return {error: result.error ? toLinkError(result.error) : null};
  }
  const toAbsolute = (url: string): string => new URL(url, window.location.href).toString();
  // Without an error page, Better Auth would send a failed link to its own page on the API.
  const intent = await client.$fetch<LinkIntentResponse>("/oauth-handoff/link-intent", {
    body: {
      callbackURL: toAbsolute(callbackURL),
      errorCallbackURL: toAbsolute(errorCallbackURL ?? callbackURL),
      provider,
    },
    method: "POST",
  });
  if (intent.error) {
    return {error: toLinkError(intent.error)};
  }
  const {startURL, token} = intent.data ?? {};
  if (!token || !isHttpURL(startURL)) {
    console.warn("[terreno/rtk] The link intent answered without a usable token or start URL");
    return {error: {message: "The link intent answered without a token", status: 500}};
  }
  submitLinkForm(startURL, token);
  return {error: null};
};
