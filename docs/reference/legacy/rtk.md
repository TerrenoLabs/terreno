# @terreno/rtk (legacy)

> **Deprecated for data synchronization.** `@terreno/rtk` remains published through the **56.x** line (and the stable **0.x** line) with a deprecation notice. It will **not** be published in the next major Terreno release. For collection reads/writes, offline sync, and realtime convergence, use [`@terreno/syncdb`](../syncdb.md) and the [migration guide](../../how-to/migrate-rtk-to-syncdb.md).
>
> RTK Query remains the correct tool for **non-synced** generated OpenAPI routes
> such as `/auth/me` and AI APIs, Better Auth session Redux wiring, feature
> flags, and sockets. Built-in admin RPC uses host-bound fetch; ObjectId/API-only
> admin CRUD keeps RTK compatibility in Terreno 57, then `useAdminApi` and the
> required admin `api` prop are removed in Terreno 58.

Redux Toolkit Query utilities for frontends using @terreno/api backends. JWT auth, token storage, SDK code generation from OpenAPI, and real-time WebSocket connections.

## Table of Contents

- [Authentication](#authentication)
- [WebSocket Integration](#websocket-integration)
- [Cache Management](#cache-management)
- [Token Management](#token-management)
- [SDK Generation](#sdk-generation)
- [Debugging](#debugging)
- [Platform Detection](#platform-detection)

## Authentication

### generateAuthSlice

Creates a complete Redux auth system with JWT token management, automatic token refresh, and secure storage.

``````typescript
import {generateAuthSlice} from "@terreno/rtk";
import {configureStore} from "@reduxjs/toolkit";
import {openapi} from "./openApiSdk";

const {authReducer, logout, setUserId, middleware} = generateAuthSlice(openapi);

export const store = configureStore({
  reducer: {
    auth: authReducer,
    [openapi.reducerPath]: openapi.reducer,
  },
  middleware: (getDefault) =>
    getDefault().concat(openapi.middleware, ...middleware),
});
``````

**Returns:**
- `authReducer` — Redux reducer for auth state
- `authSlice` — Full Redux slice
- `logout` — Action to clear tokens and reset state
- `setUserId` — Action to set current user ID
- `tokenRefreshedSuccess` — Action signaling token refresh
- `middleware` — Login/logout listener middleware array

**Auth State:**
``````typescript
{
  userId: string | null;
  error: string | null;
  lastTokenRefreshTimestamp: number | null;
}
``````

**Built-in Endpoints:**
- `emailLogin` — POST `/auth/login`
- `emailSignUp` — POST `/auth/signup`
- `googleLogin` — POST `/auth/google`
- `createEmailUser` — Create user without login (admin use)
- `resetPassword` — POST `/resetPassword`

**Token Storage:**
- **Native (iOS/Android):** Secure encrypted storage via `expo-secure-store`
- **Web:** `@react-native-async-storage/async-storage` with SSR safety
- Automatic storage/retrieval on login/logout via listener middleware

**Selectors:**
``````typescript
import {selectCurrentUserId, useSelectCurrentUserId} from "@terreno/rtk";

// Hook version
const userId = useSelectCurrentUserId();

// Selector version
const userId = selectCurrentUserId(state);
``````

### Better Auth Integration

For apps using Better Auth instead of JWT:

``````typescript
import {configureStore} from "@reduxjs/toolkit";
import {createBetterAuthClient, generateBetterAuthSlice} from "@terreno/rtk";

// Create Better Auth client. `scheme` is the app's deep-link scheme (required).
export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
  scheme: "myapp",
});

// Generate the session Redux slice
const betterAuth = generateBetterAuthSlice({authClient});

export const store = configureStore({
  reducer: {
    betterAuth: betterAuth.reducer, // selectors read `state.betterAuth`
    // ... other reducers
  },
  middleware: (getDefault) => getDefault().concat(...betterAuth.middleware),
});

// Call after sign-in, sign-out, and at app startup to copy the session into Redux
void betterAuth.syncSession(store.dispatch);
``````

**Key exports:**
- `createBetterAuthClient({baseURL, scheme, storagePrefix?, webAuth?, bearerStorage?, features?})` — Factory for Better Auth client with Expo support. `webAuth: "bearer"` authenticates the web client with a stored bearer token and no cookies, for a frontend and API on different sites ([how-to](../../how-to/configure-better-auth.md#frontend-and-api-on-different-sites)). `features` (`BetterAuthClientFeatures`: `twoFactor?: boolean | {onTwoFactorRedirect}`, `passkey?`, `multiSession?`, `lastLoginMethod?`, `oneTimeToken?`) adds `twoFactorClient`, `passkeyClient` (`@better-auth/passkey/client`), `multiSessionClient`, `lastLoginMethodClient` and `oneTimeTokenClient` after the Expo plugin, and types their namespaces (`client.twoFactor.enable`, `client.passkey.addPasskey`, `client.multiSession.listDeviceSessions`, `client.getLastUsedLoginMethod`, `client.oneTimeToken.verify`). Without `features`, or when its type does not name the features (a config typed `BetterAuthClientConfig`), the return type is `BetterAuthClient`, unchanged. In bearer mode `multiSession` lists no sessions and 2FA and passkey challenges need cookies ([how-to](../../how-to/configure-better-auth.md#client-features))
- `BetterAuthClient` — The client type without `features` (also `ReturnType<typeof createBetterAuthClient>`). `BetterAuthClientWithFeatures<Features>` — the client type with them. `BetterAuthClientFor<Features>` — which of the two `createBetterAuthClient` returns. `BetterAuthHandoffClient` — what the OAuth handoff helpers accept: any client from `createBetterAuthClient`
- `BetterAuthOAuthProvider` — `"google" | "github" | "apple"` or any generic OAuth provider id, such as `"mock-oidc"`
- `getBetterAuthBearerToken({storagePrefix?, bearerStorage?})` — Reads the token bearer mode stored, or `null`
- `signInSocialWithHandoff({client, provider, callbackURL?, errorCallbackURL?})` — Starts a social or generic OAuth sign-in for a web bearer client: stores a random nonce in `sessionStorage` and navigates the page to the server's `{basePath}/oauth-handoff/start` with `handoff=<nonce>` on the callback URLs. Throws on native and in cookie mode ([how-to](../../how-to/configure-better-auth.md#social-sign-in-in-bearer-mode))
- `completeBetterAuthOAuthHandoff({client}): Promise<boolean>` — On the return page, removes `#ott` and `handoff` from the URL first, then exchanges the token at `{basePath}/one-time-token/verify` only when `handoff` matches the stored nonce. Resolves `true` only when a bearer token was stored; never rejects. Await it at startup before session reads and Sentry
- `linkSocialWithHandoff({client, provider, callbackURL, errorCallbackURL?}): Promise<{error}>` — Links a provider to the signed-in user. On web in bearer mode it posts the intent to `{basePath}/oauth-handoff/link-intent` with the bearer, then submits the returned single-use token in a hidden POST form to `startURL`, which redirects to the provider; the page comes back to `callbackURL` with no `#ott`. Both URLs may be any page on a web origin (`callbackPaths` do not apply); `errorCallbackURL` defaults to `callbackURL`. In cookie mode and on native it calls `client.linkSocial`. Resolves `{error: null}` once the browser is on its way, or `{error: {status, code?, message?}}` (such as 403 `LINKING_DISABLED`) without submitting anything. `BetterAuthLinkClient` is its client type ([how-to](../../how-to/configure-better-auth.md#linking-a-provider-in-bearer-mode))
- `useAuthMethods(authClient): {methods, isLoading, error}` — Loads the server's enabled sign-in methods (`BetterAuthMethods`: `providers`, `emailPassword`, `signUp`, `accountLinking`, and feature flags) once per client from `{basePath}/terreno/methods` through the client's `$fetch`, so bearer and cookie modes both work. `methods` is `undefined` while loading and after an error; render no provider buttons until it arrives ([response](../api.md#better-auth-authentication))
- `createRememberedAccountsStore({rememberIdentity, storageKey?, max?, storage?})` — On-device store of accounts that signed in here, for the login screen. Returns `{record(entry), forget(userId), clear(), list(), lastUsedMethod(), isHydrated(), ready, getSnapshot(), subscribe(listener), dispose()}`. Each change re-reads storage first, and on web the store follows `storage` events for its key until `dispose()`, so a stale tab cannot bring back a forgotten account. A failed change rejects to its caller without blocking later changes. Persists `{userId, method, lastUsedAt}` (newest first, at most `max`, default 5, and at most 2048 bytes) under `storageKey` (default `terreno_remembered_accounts`) in SecureStore on native (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS) or localStorage on web. `rememberIdentity` is required: pass `false` to keep only the method. `name` (in clear), a masked `email`, and an `https://` `image` are kept only with `rememberIdentity: true`. Unreadable or oversized stored data resets to an empty list ([how-to](../../how-to/configure-better-auth.md#4-remember-accounts-on-this-device))
- `useRememberedAccounts(store): {accounts, lastUsedMethod, isHydrated, forget, clear}` — Subscribes a component to the store. `isHydrated` is `false` until native storage has loaded
- `toLoginAccountOptions(accounts)` — Maps `RememberedAccount[]` to `@terreno/ui` `LoginAccountOption[]` (`id` is the `userId`) for `LoginScreen`'s `rememberedAccounts`
- `maskEmail(email)` — `josh@mail.flourish.health` → `j***@m***.health`: first character of the local part and domain, subdomains hidden, top-level domain kept; `undefined` for non-emails
- `generateBetterAuthSlice({authClient, syncInterval?})` — Returns `{reducer, middleware, actions, slice, syncSession, authClient}`
- `selectBetterAuthIsAuthenticated`, `selectBetterAuthUserId`, `selectBetterAuthUser` — Selectors over `state.betterAuth`
- `BetterAuthUser`, `BetterAuthState` — TypeScript types for session/user data

**Session State (`state.betterAuth`):**
``````typescript
{
  isAuthenticated: boolean;
  userId: string | null;
  user: BetterAuthUser | null;
  isLoading: boolean;
  error: string | null;
  lastSyncTimestamp: number | null;
}
``````

**Learn more:** [Configure Better Auth](../../how-to/configure-better-auth.md)

### Token source

rtk reads the request token from one registered **token source**, typed as syncdb's
`AuthProvider` (`getToken`, `getUserId`, `onAuthChange`, optional `refresh`). A Better Auth
app registers the same adapter it builds for syncdb, once at startup:

``````typescript
import {setTokenSource} from "@terreno/rtk";
import {betterAuthAdapter, bridgeBetterAuthReactClient} from "@terreno/syncdb";
import {authClient} from "./betterAuth";

export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(authClient));
setTokenSource(authProvider); // before the first RTK Query request
``````

With `webAuth: "bearer"`, also pass the adapter `getBearerToken` so it reads the stored token
without a `get-session` call ([syncdb adapter](../syncdb.md#createsyncdb-configuration)).

**Exports:**
- `setTokenSource(source | undefined)` — Registers the source. `undefined` restores the default.
- `getTokenSource()` — The registered source, or `undefined` when none is registered.
- `jwtTokenSource` — The legacy JWT source: `getToken` is `getAuthToken`, `refresh` runs
  `refreshAuthToken` and resolves `true` on success, `getUserId` reads the stored JWT's `id`
  (or `sub`) claim, and `onAuthChange` fires on JWT login, logout, and token refresh.
- `isJwtTokenSource(source)` — `true` for `undefined` or `jwtTokenSource`.

**Base query behavior (`emptySplitApi` / `staggeredBaseQuery`):**
- **No source registered, or `jwtTokenSource`:** the JWT path below, unchanged. JWT apps need
  no code change.
- **Any other source:** sends `authorization: Bearer <token>` from `getToken()` on every
  request, or no `authorization` header when the token is null. It never logs out because a
  token is missing. On a 401 it calls `refresh()` once (shared by concurrent requests), re-reads
  the token, and retries once; only a second 401 dispatches `auth/logout`. The public endpoints
  `emailLogin`, `emailSignUp`, `getVersionCheck`, `getZoomSignature`, and `googleLogin` skip
  the refresh and retry.

The registry is module-global, like `baseUrl`: one app, one source. Apps that forked the base
query to read the Better Auth session can point their SDK back at `emptySplitApi` once they
register the source.

**Other consumers.** The socket, chat, MCP, and offline APIs read the same source. Each takes a
`tokenSource` option that overrides it for that one consumer. Without the option they use the
registered source, else `jwtTokenSource`. Pass `useSocketConnection` a stable object, not a new
one per render, or it re-subscribes to `onAuthChange`.

| API | Option | How it uses the source |
| --- | --- | --- |
| `useSocketConnection` | `tokenSource`, used when `getAuthToken` is omitted | Reads `getToken()` on every connect and reconnect, refreshes once per auth failure, and reconnects when `onAuthChange` brings a new token. See [useSocketConnection](#usesocketconnection). |
| `useTerrenoChat` | `tokenSource` | Reads `getToken()` per chat request. Sends no `Authorization` header when it returns null. |
| `useMCPTools` | `tokenSource` | Reads `getToken()` before every MCP request, so a refreshed token needs no refetch. A fetch that starts with no token connects without auth. |
| `createOfflineMiddleware` | `tokenSource` | With a non-JWT source, tags queued mutations with `getUserId()` and replays them with `getToken()`. See [Offline queue](#offline-queue). |

#### Offline queue

`createOfflineMiddleware({endpoints, api, tokenSource?})` queues the listed mutations while
offline and replays them on reconnect.

- **JWT source:** the queue reads `state.auth.userId` and the stored JWT, as before.
- **Any other source** (for example syncdb's `betterAuthAdapter`): each queued mutation carries
  `userId` from `getUserId()`. Replay runs only while that same user is signed in. It sends
  `authorization: Bearer <token>` from `getToken()`, or no header when the token is null.
- **Last user id:** `state.offline.lastUserId` holds the last id the source confirmed. It
  refreshes on the first action, on rehydrate, on `onAuthChange`, and on reconnect, so a failed
  session read while offline does not untag new mutations.
- **Persist the `offline` slice** with redux-persist (do not blacklist it). Otherwise mutations
  made after an app launches offline carry no user and are dropped on reconnect.
- **Unconfirmed ids:** a rehydrated id is unconfirmed until a read in this process returns a
  user. Mutations tagged with it carry `userIdConfirmed: false`. A later read keeps them only
  when it names the same user and no `onAuthChange` or source swap happened since. Any auth
  change drops them, even for the same user.
- **Cost:** syncdb's `betterAuthAdapter` fires `onAuthChange` on the session's first successful
  load. After an offline launch that happens when the network returns, so it drops
  offline-launch writes the reconnect read has not confirmed yet.
- **Residual risk:** the signed-in user changes while no running instance of the middleware sees
  it (for example in another browser tab that shares the persisted slice), between an
  unconfirmed write and the next launch's first read. Then that write can replay as a user who
  did not make it.
- **Sign-out:** `auth/logout`, `betterAuth/logout` (on a non-JWT source), or the source
  reporting no user after `onAuthChange` clears the queue, conflicts, and `lastUserId`, and
  discards in-flight enqueues and replays.
- **No user on reconnect:** when the source has no user, or the user changes during a replay,
  the rest of the queue stays for a later reconnect.
- **Different user on reconnect:** a replay drops each mutation queued by a user other than the
  one signed in.

Offline-slice exports the middleware uses for the user tag (exported from the package root):

- `setLastUserId(userId | undefined)` — Action that sets `state.offline.lastUserId`.
- `resolveUnconfirmedMutations(userId)` — Action that keeps unconfirmed mutations tagged with
  `userId`, marks them confirmed, and drops the other unconfirmed ones.
- `dropUnconfirmedMutations()` — Action that drops every mutation whose user id is unconfirmed.
- `selectLastUserId(state)` — The last user id the source confirmed, or `undefined` when unknown
  or signed out.

## WebSocket Integration

> **Deprecated (removed in Terreno 58):** `realtimeList`, `realtimeDocument`, `setRealtimeSocket`, and `getRealtimeSocket` patch RTK Query caches from `sync` events. Use [`@terreno/syncdb`](../syncdb.md). `useSocketConnection` remains for feature flags and other sockets.

### useSocketConnection

React hook for managing Socket.io connections with automatic reconnection, token refresh, and user feedback.

``````typescript
import {useSocketConnection} from "@terreno/rtk";

// Reads the token source registered with setTokenSource (the JWT in storage by default).
const {socket, isSocketConnected} = useSocketConnection({
  baseUrl: "wss://api.example.com",
  shouldConnect: !!userId,
  onConnect: () => console.info("WebSocket connected"),
  onDisconnect: () => console.warn("WebSocket disconnected"),
  onConnectError: (error) => console.error("Connection error:", error),
  captureEvent: (eventName, data) => analytics.track(eventName, data),
});

// Use socket for real-time events
useEffect(() => {
  if (!socket) return;
  
  socket.on("notification", (data) => {
    console.info("Received notification:", data);
  });
  
  return () => {
    socket.off("notification");
  };
}, [socket]);
``````

**Options:**
- `baseUrl` (string, required) — WebSocket server URL
- `shouldConnect` (boolean, required) — Whether to connect (typically `!!userId`)
- `tokenSource` (`AuthProvider`) — Source for the handshake token. Defaults to the
  [registered source](#token-source), else `jwtTokenSource`. Used only when `getAuthToken` is
  omitted.
- `getAuthToken` (function) — Legacy getter. When passed, the hook reads the token once per
  connect, sends it as a static `auth` payload, and ignores `tokenSource`.
- `onConnect` (function) — Callback on successful connection
- `onDisconnect` (function) — Callback on disconnection
- `onConnectError` (function) — Callback on connection error
- `onReconnectFailed` (function) — Callback after all reconnection attempts fail
- `captureEvent` (function) — Analytics event tracking (optional)

**Returns:**
- `socket` (Socket | null) — Socket.io client instance
- `isSocketConnected` (object) — Connection state with `{isConnected: boolean, lastDisconnectedAt: string | null}`

**Features:**
- **Automatic reconnection:** 5 attempts with exponential backoff (1-5 seconds)
- **Bearer token authentication:** Sends `Bearer <token>` in `socket.auth`
- **Token refresh integration:** Reconnects automatically when tokens are refreshed
- **User feedback:** Toast notifications for disconnections (after 9+ seconds) and token errors
- **Connection monitoring:** Periodic checks with automatic reconnection attempts
- **SSR-safe:** Checks `typeof window` before initialization

**Toast Behavior:**
- **Disconnection:** Shows "You have been disconnected. Attempting to reconnect..." after 9 seconds
- **Reconnection:** Shows "You have been reconnected" (suppressed if reconnect within 10 seconds)
- **Token error:** Shows "Error refreshing token. Please log out and log back in..." with persistent error state

**Token source behavior (no `getAuthToken`):**
- The handshake reads `getToken()` on every connect and reconnect, including socket.io's own
  reconnects.
- On an auth `connect_error` (the server's `UnauthorizedError`), the hook calls `refresh()`
  once and reconnects. A second auth failure before a successful connect stops reconnecting and
  calls `onConnectError`. If the source has no `refresh`, or it fails, the hook stops at once.
  A successful connect resets this.
- While `shouldConnect` is true, an `onAuthChange` with a different token drops a live
  connection and reconnects with the new token. With no token it disconnects. The same token
  keeps the connection up.

**JWT token management** (`getAuthToken` passed, or the JWT source):
- Checks token expiration on disconnect and connection errors
- Automatically refreshes tokens if expiring within 60 seconds
- Attempts reconnection after successful token refresh
- Tracks refresh events via Redux state (`lastTokenRefreshTimestamp`)

## Cache Management

### generateTags

Generates RTK Query cache tags for automatic invalidation.

``````typescript
import {providesIdTags, invalidatesIdTags} from "@terreno/rtk";

// In your API endpoints
getTodos: build.query({
  query: () => "/todos",
  providesTags: providesIdTags("todos"), // Tags individual items + collection
}),

createTodo: build.mutation({
  query: (body) => ({url: "/todos", method: "POST", body}),
  invalidatesTags: invalidatesIdTags("todos"), // Invalidates collection
}),
``````

**Functions:**
- `providesIdTags(tagName)` — Returns tags for list responses (individual items + collection tag)
- `invalidatesIdTags(tagName)` — Returns tags to invalidate on mutations

### populateId

Helper for normalizing MongoDB ObjectIds in RTK Query responses.

``````typescript
import {populateId} from "@terreno/rtk";

// Ensures _id is properly handled in Redux normalization
const normalizedData = populateId(responseData);
``````

### ListResponse

Standard interface for paginated list responses from @terreno/api:

``````typescript
interface ListResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  more: boolean;
}
``````

## Token Management

### Token Expiration Helpers

``````typescript
import {
  getAuthToken,
  getTokenExpirationTimes,
  getFriendlyExpirationInfo,
  shouldShowStillThereModal,
} from "@terreno/rtk";

// Get current token from secure storage
const token = await getAuthToken();

// Check token expiration times
const {authRemainingSecs, refreshRemainingSecs} = await getTokenExpirationTimes();
console.info(`Auth token expires in ${authRemainingSecs} seconds`);

// Get human-readable expiration info
const info = await getFriendlyExpirationInfo();
console.info(info); // "Auth: 14m 23s, Refresh: 29d 23h"

// Check if should show "still there?" modal (refresh token <= 65 seconds)
if (shouldShowStillThereModal()) {
  showModal("Your session is about to expire. Continue?");
}
``````

**Functions:**
- `getAuthToken()` — Returns JWT token from secure storage
- `getRefreshToken()` — Returns refresh token from secure storage
- `getTokenExpirationTimes()` — Returns `{authRemainingSecs, refreshRemainingSecs}`
- `getFriendlyExpirationInfo()` — Returns formatted expiration string
- `shouldShowStillThereModal()` — Returns true if refresh token expires in <= 65 seconds

## SDK Generation

### OpenAPI Code Generation

Generate typed RTK Query hooks from your @terreno/api backend's OpenAPI spec.

**Configuration (openapi-config.ts):**
``````typescript
import type {ConfigFile} from "@rtk-query/codegen-openapi";

const config: ConfigFile = {
  apiFile: "@terreno/rtk",
  apiImport: "emptySplitApi",
  outputFile: "./store/openApiSdk.ts",
  schemaFile: "http://localhost:4000/openapi.json",
  hooks: true,
  tag: true,
  flattenArg: true,
  argSuffix: "Args",
  responseSuffix: "Res",
};

export default config;
``````

**Generate SDK:**
``````bash
# Backend must be running on the specified port
npx @rtk-query/codegen-openapi openapi-config.ts
``````

**Usage:**
``````typescript
import {useGetTodosQuery, usePostTodosMutation} from "@/store/openApiSdk";

const {data, isLoading, error, refetch} = useGetTodosQuery({completed: false});
const [createTodo, {isLoading: isCreating}] = usePostTodosMutation();
``````

**Critical Rules:**
- **Never modify `openApiSdk.ts` manually** — it is auto-generated
- **Never use `axios` or `fetch` directly** — always use generated hooks
- Regenerate SDK after any backend route changes

### emptyApi / emptySplitApi

Base RTK Query API with authentication, retry logic, and automatic token refresh.

**Features:**
- **Axios with retry:** 3 retries with exponential backoff for queries
- **Token refresh:** Automatically refreshes tokens when < 2 minutes from expiry
- **Mutex locking:** Prevents simultaneous token refreshes across concurrent requests
- **401 handling:** Auto-refreshes token on 401 responses and retries the request
- **Mutation safety:** Mutations don't retry on non-401 errors (prevents duplicates)
- **Query serialization:** Uses `qs.stringify()` for complex queries (`$in`, `$lt`, `$gte`)

**Automatic Headers:**
- `authorization: Bearer <token>` (from the registered [token source](#token-source); the JWT in storage by default)
- `App-Version` (from Expo config)
- `App-Platform` ("web" or "mobile")

**Response Handling:**
- 204 responses return `null`
- List endpoints return full response: `{data, more, page, limit, total}`
- CRUD endpoints extract and return `result.data`

**Base URL Resolution (priority order):**
1. `Constants.expoConfig?.extra?.BASE_URL` (production/staging)
2. `process.env.EXPO_PUBLIC_API_URL` (dev web)
3. `Constants.expoConfig?.hostUri` + the dev API port (dev simulator/device)
4. `http://localhost:<dev API port>` (fallback)

The dev API port defaults to `4000` and is overridable per app via `EXPO_PUBLIC_DEV_API_PORT`
or `expoConfig.extra.DEV_API_PORT` (for example `3000` or `9000`).

## Debugging

### Debug Logging

``````typescript
import {logAuth, logSocket, AUTH_DEBUG, WEBSOCKETS_DEBUG} from "@terreno/rtk";

// Check if debug logging is enabled (via expoConfig.extra)
console.info("Auth debug:", AUTH_DEBUG);
console.info("WebSocket debug:", WEBSOCKETS_DEBUG);

// Log auth events (only logs if AUTH_DEBUG is true)
logAuth("Token refreshed", {userId, timestamp: Date.now()});

// Log socket events (only logs if WEBSOCKETS_DEBUG is true)
logSocket("Connected", {socketId: socket.id});
``````

**Enable Debug Logging:**

Add to your `app.json` or `app.config.ts`:
``````json
{
  "expo": {
    "extra": {
      "AUTH_DEBUG": true,
      "WEBSOCKETS_DEBUG": true
    }
  }
}
``````

## Platform Detection

``````typescript
import {IsWeb} from "@terreno/rtk";

if (IsWeb) {
  console.info("Running on web platform");
} else {
  console.info("Running on native (iOS/Android)");
}
``````

**Platform-specific behavior:**
- **Token storage:** SecureStore (native) vs AsyncStorage (web)
- **WebSocket:** Uses native WebSocket API on both platforms
- **SSR safety:** Web code checks `typeof window !== "undefined"` before browser APIs

## Environment Variables

Configuration for frontend apps using @terreno/rtk:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXPO_PUBLIC_API_URL` | No | Auto-detected | Backend API base URL (production/staging deployments) |
| `EXPO_PUBLIC_DEV_API_PORT` | No | 4000 | Local dev API port for host/localhost resolution (also settable via `extra.DEV_API_PORT`) |
| `NODE_ENV` | No | `development` | Environment: `development`, `production`, `test` |

**Base URL resolution priority:**

1. `Constants.expoConfig?.extra?.BASE_URL` (from `app.json` `extra` field)
2. `process.env.EXPO_PUBLIC_API_URL` (for web development)
3. `Constants.expoConfig?.hostUri` + the dev API port (for Expo dev server - simulator/device)
4. `http://localhost:<dev API port>` (fallback)

The dev API port defaults to `4000` and is overridable per app via `EXPO_PUBLIC_DEV_API_PORT`
or `expoConfig.extra.DEV_API_PORT` (for example `3000` or `9000`).

**Example `app.json` configuration:**

``````json
{
  "expo": {
    "extra": {
      "BASE_URL": "https://api.example.com",
      "AUTH_DEBUG": true,
      "WEBSOCKETS_DEBUG": false
    }
  }
}
``````

**Debug flags (via `app.json` `extra` field):**

- `AUTH_DEBUG` — Enable verbose auth logging (token refresh, login/logout)
- `WEBSOCKETS_DEBUG` — Enable WebSocket connection/disconnection logs

**Example `.env` for web development:**

``````env
EXPO_PUBLIC_API_URL=http://localhost:4000
``````

## Related Documentation

- [Authentication Architecture](../../explanation/authentication.md) — Deep-dive into JWT + Passport system
- [WebSocket Integration How-To](../../how-to/websocket-integration.md) — Real-time connection setup
- [Add GitHub OAuth](../../how-to/add-github-oauth.md) — Step-by-step OAuth setup guide
- [@terreno/api Reference](../api.md) — Backend API framework
- [@terreno/ui Reference](../ui.md) — React Native components
