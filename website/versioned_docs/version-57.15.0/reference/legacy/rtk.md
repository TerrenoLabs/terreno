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
import {createBetterAuthClient, generateBetterAuthSlice} from "@terreno/rtk";
import {configureStore} from "@reduxjs/toolkit";

// Create Better Auth client
export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
});

// Generate session Redux slice
const {sessionReducer, sessionMiddleware} = generateBetterAuthSlice(authClient);

export const store = configureStore({
  reducer: {
    session: sessionReducer,
    // ... other reducers
  },
  middleware: (getDefault) => getDefault().concat(sessionMiddleware),
});
``````

**Key exports:**
- `createBetterAuthClient` — Factory for Better Auth client with Expo support
- `generateBetterAuthSlice` — Redux slice for session state management
- `BetterAuthSessionData` — TypeScript types for session/user data

**Session State:**
``````typescript
{
  session: BetterAuthSession | null;
  user: BetterAuthUser | null;
  isLoading: boolean;
}
``````

**Learn more:** [Configure Better Auth](../../how-to/configure-better-auth.md)

## WebSocket Integration

> **Deprecated (removed in Terreno 58):** `realtimeList`, `realtimeDocument`, `setRealtimeSocket`, and `getRealtimeSocket` patch RTK Query caches from `sync` events. Use [`@terreno/syncdb`](../syncdb.md). `useSocketConnection` remains for feature flags and other sockets.

### useSocketConnection

React hook for managing Socket.io connections with automatic reconnection, token refresh, and user feedback.

``````typescript
import {useSocketConnection} from "@terreno/rtk";

const {socket, isSocketConnected} = useSocketConnection({
  baseUrl: "wss://api.example.com",
  shouldConnect: !!userId,
  getAuthToken: () => getAuthToken(),
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
- `getAuthToken` (function, required) — Async function returning JWT token
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
- **Bearer token authentication:** Automatically includes JWT in `socket.auth`
- **Token refresh integration:** Reconnects automatically when tokens are refreshed
- **User feedback:** Toast notifications for disconnections (after 9+ seconds) and token errors
- **Connection monitoring:** Periodic checks with automatic reconnection attempts
- **SSR-safe:** Checks `typeof window` before initialization

**Toast Behavior:**
- **Disconnection:** Shows "You have been disconnected. Attempting to reconnect..." after 9 seconds
- **Reconnection:** Shows "You have been reconnected" (suppressed if reconnect within 10 seconds)
- **Token error:** Shows "Error refreshing token. Please log out and log back in..." with persistent error state

**Token Management:**
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
- `authorization: Bearer <token>`
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
