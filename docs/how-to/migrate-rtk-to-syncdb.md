# How to upgrade from @terreno/rtk to @terreno/syncdb (Terreno 58)

Terreno 58 deletes `@terreno/rtk` and every Redux dependency. `@terreno/syncdb` is the only
frontend data and session layer:

| Concern | 57.x (`@terreno/rtk` + Redux) | 58 (`@terreno/syncdb`) |
|---------|-------------------------------|------------------------|
| Collection CRUD | RTK Query hooks from `store/openApiSdk.ts` | `useQuery` / `useMutate` (`@terreno/syncdb/react`) |
| Every other route (`/auth/me`, actions, AI, consents) | RTK Query hooks from `store/openApiSdk.ts` | Generated hooks in `store/apiSdk.ts` on the request client (`@terreno/syncdb/api`) |
| Session | `generateBetterAuthSlice` / `generateAuthSlice` + Redux selectors | `SessionProvider` + `useSession()` (`@terreno/syncdb/auth`) |
| Feature flags, server pushes | `useSocketConnection` (second socket) + `useTerrenoFeatureFlags(api, …)` | `useSocketEvent` on the sync socket + `useTerrenoFeatureFlags({client, socket})` (`@terreno/syncdb/flags`) |
| Base URLs, upgrade check, RBAC, dev logger, MCP tools | `@terreno/rtk` root | `@terreno/syncdb/config`, `@terreno/syncdb/app` |
| App state | Redux slice + `redux-persist` | React context / `useStoredState` |

Work through the steps in order. Every removed export and its replacement is in
[the export table](#every-removed-export).

## 1. Run the backend migrations

`installDevConsoleLogger` lives on `@terreno/syncdb/app` (or `@terreno/syncdb/devConsoleLogger`). Pass the API base URL once at startup:

```typescript
import {installDevConsoleLogger} from "@terreno/syncdb/app";
import {baseUrl} from "@terreno/syncdb/config";

installDevConsoleLogger({baseUrl});
```


`GptHistory` and `McpServiceToken` now have String `_id`s and sync. Run both data migrations
**before** deploying 58 frontends. See the
[58.0.0 upgrade note](https://github.com/TerrenoLabs/terreno/blob/master/mcp-server/src/docs/upgrades/58.0.0.md#gpt-histories-are-a-synced-collection).

Every collection the app reads or writes as a list needs the sync backend: `syncPlugin` +
`isDeletedPlugin` on the schema, a `sync` config on `modelRouter`, and `SyncApp` + `RealtimeApp`
on a MongoDB replica set. See [Backend setup](../reference/syncdb.md#backend-setup).

## 2. Swap the packages

```bash
bun remove @terreno/rtk @reduxjs/toolkit react-redux redux-persist @rtk-query/codegen-openapi
bun add @terreno/syncdb
bunx expo install expo-sqlite expo-secure-store @react-native-async-storage/async-storage
```

Keep `better-auth`, `@better-auth/expo`, and `@openfeature/react-sdk` / `@openfeature/web-sdk`
if the app uses them; they are optional peers of `@terreno/syncdb`. Rebuild native clients
after adding `expo-sqlite`.

Delete `store/index.ts`, `store/appState.ts`, `store/sdk.ts`, `store/openApiSdk.ts`,
`store/betterAuthApi.ts`, `openapi-config.ts`, `scripts/generate-sdk.ts`, and
`tsconfig.codegen.json`.

## 3. Create the clients

One `authProvider` feeds the sync client and the request client, so both send the same token
and refresh on a 401 the same way.

```typescript
// lib/betterAuth.ts
import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";

export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: "myapp",
  storagePrefix: "myapp",
});
```

```typescript
// store/syncdb.ts
import {betterAuthAdapter, bridgeBetterAuthReactClient, createSyncDb} from "@terreno/syncdb";
import {baseUrl} from "@terreno/syncdb/config";
import {betterAuthClient} from "@/lib/betterAuth";
import {SYNC_COLLECTIONS} from "@/store/syncDbSdk";

export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient));

export const syncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: [...SYNC_COLLECTIONS],
  name: "myapp",
  wipeOnSignOut: true,
});
```

```typescript
// store/apiClient.ts
import {createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {authProvider} from "@/store/syncdb";

export const apiClient = createApiClient({
  authProvider,
  baseUrl,
  credentials: "include",
  headers: appHeaders,
  onError: (error) => console.warn(error.message),
});
```

Apps on `@terreno/api` JWT routes (no Better Auth) use `jwtAuthAdapter` as the
`authProvider` and `SessionProvider` `source`. See
[JWT auth (legacy)](../reference/syncdb.md#jwt-auth-legacy).

## 4. Replace the Redux store with providers

```tsx
// app/_layout.tsx
import {installDevConsoleLogger} from "@terreno/syncdb/app";
import {SessionProvider} from "@terreno/syncdb/auth";
import {ApiClientProvider, SyncDbProvider} from "@terreno/syncdb/react";

installDevConsoleLogger();

const RootLayout: React.FC = () => (
  <SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]} onLogout={() => apiClient.reset()}>
    <ApiClientProvider client={apiClient}>
      <SyncDbProvider client={syncDb}>
        <App />
      </SyncDbProvider>
    </ApiClientProvider>
  </SessionProvider>
);
```

Start the sync client when a user signs in:

```typescript
const {userId} = useSession();

// Start syncdb for the signed-in user; stop it on sign-out or user switch.
useEffect(() => {
  if (!userId) {
    return;
  }
  void syncDb.start();
  return () => {
    void syncDb.stop();
  };
}, [userId]);
```

Remove `<Provider store={store}>`, `<PersistGate>`, `configureStore`, and every
`useSelector` / `useDispatch`. Move app-state slices to React context or `useStoredState`
from `@terreno/ui`.

| Redux session code | Replacement |
|--------------------|-------------|
| `useSelector(selectBetterAuthUserId)` / `useSelectCurrentUserId()` | `useSession().userId` |
| `useSelector(selectBetterAuthIsAuthenticated)` | `useSession().isAuthenticated` |
| `useSelector(selectBetterAuthUser)` | `useSession().user` |
| `useSelector(selectBetterAuthIsLoading)` / `useSelectIsAuthenticating()` | `useSession().isLoading` (Better Auth) or `useJwtAuth().isAuthenticating` (JWT) |
| `dispatch(logout())` / `LOGOUT_ACTION_TYPE` listeners | `await useSession().logout()`; extra cleanup goes in `SessionProvider` `onLogout` |
| `dispatch(api.util.resetApiState())` on logout | `apiClient.reset()` in `onLogout` |

## 5. Regenerate the SDK

`terreno-syncdb-codegen --api-out` replaces `@rtk-query/codegen-openapi`. It emits typed hooks
for every operation without `x-terreno-sync`, with the same names RTK codegen used.

```json
{
  "scripts": {
    "sdk": "terreno-syncdb-codegen --schema ${OPENAPI_URL:-http://localhost:4000/openapi.json} --api-out ./store/apiSdk.ts",
    "sync-sdk": "terreno-syncdb-codegen --schema ${OPENAPI_URL:-http://localhost:4000/openapi.json} --out ./store/syncDbSdk.ts"
  }
}
```

With the backend running, run `bun run sdk && bun run sync-sdk`, then change imports:

| 57.x | 58 |
|------|----|
| `import {useGetMeQuery, usePatchMeMutation} from "@/store/sdk"` | `import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk"` |
| `import {usePostGptPromptMutation} from "@/store/openApiSdk"` | `import {usePostGptPromptMutation} from "@/store/apiSdk"` |
| `api.injectEndpoints({endpoints: …})` | `useApiQuery` / `useApiMutation` from `@terreno/syncdb/react`, or document the route in OpenAPI and regenerate |
| `api.util.invalidateTags([...])` | `apiClient.invalidateTags([...])` |
| `api.util.updateQueryData(...)` | Move the collection to syncdb, or `refetch()` |

Hooks keep the `{data, error, isLoading, isFetching, refetch}` and `[trigger, state]` shapes,
and `.unwrap()` still resolves the data or throws. Errors are `ApiError` (`status`,
`data.title`, `data.detail`). See [Regenerate the API SDK](generate-the-client-sdk.md).

## 6. Move flags, pushes, and app utilities

```typescript
import {useTerrenoFeatureFlags} from "@terreno/syncdb/flags";
import {useSocketEvent} from "@terreno/syncdb/react";
import {canOpenAdminPage, useUpgradeCheck} from "@terreno/syncdb/app";

// Flags ride the sync socket; no second socket.
useTerrenoFeatureFlags({client: apiClient, skip: !userId, socket: syncDb, userId});

// Server pushes that used useSocketConnection().socket.on(...)
useSocketEvent("announcementPublished", (payload) => console.info("announcement", payload));

const {isRequired, isWarning, onUpdate} = useUpgradeCheck({recheckOnForeground: true});
const isAdmin = canOpenAdminPage({admin: me?.admin, permissions: me?.permissions});
```

| 57.x | 58 |
|------|----|
| `useSocketConnection({baseUrl, getAuthToken, …})` | Delete. The syncdb client owns the one socket. |
| `socket.on(event, handler)` | `useSocketEvent(event, handler)` or `syncDb.onSocketEvent(event, handler)` |
| `useTerrenoFeatureFlags(api, {skip, socket, userId})` | `useTerrenoFeatureFlags({client, skip, socket: syncDb, userId})` |
| `useFeatureFlags(api, options)` | `useFeatureFlags({client, skip, socket, userId})` |
| `useRealtimeDebug(baseUrl)` / `setRealtimeDebug` | `createSyncDb({debug: …})` and the terreno-mcp-local `get_syncdb_state` tool |
| `useMCPTools({baseURL})` | `useMCPTools({authProvider, baseURL})` |
| `installTerrenoDevConsoleLogger()` | `installDevConsoleLogger()` |
| `import {resolveBuildNumber} from "@terreno/rtk/buildNumber"` | `import {resolveBuildNumber} from "@terreno/syncdb/buildNumber"` |

## 7. Move collection screens to syncdb

There is no `isLoading` for reads after bootstrap; data is already local. Writes apply locally,
queue in the outbox, and replay in the background.

| RTK Query | syncdb |
|-----------|--------|
| `useGetTodosQuery({completed: false})` | `useQuery("todos", {where: {completed: false}})` |
| `{sort: "-created", limit: 20}` | `sort: "-created", limit: 20` |
| Collection too large to sync whole, `{page}` / `more` / `total` | `useWindowQuery("messages", {where, sort, pageSize})` with `fetchNextPage`, `hasMore`, `total` |
| `useGetTodosByIdQuery(id)` | `useEntity("todos", id)` |
| `usePostTodosMutation()` | `useMutate("todos").create({data: {_id: generateMutationId(), …}})` |
| `usePatchTodosByIdMutation()` | `useMutate("todos").update({id, data})` |
| `useDeleteTodosByIdMutation()` | `useMutate("todos").remove({id})` |
| Optimistic `updateQueryData`, refetch-after-mutate, write spinners | Delete; writes are local and immediate |
| 409 / `If-Unmodified-Since` handling | `useConflicts()` + a resolution UI (`ConflictSheet`) |
| `useOfflineStatus()` / `useServerStatus()` + `OfflineBanner` | `useSyncStatus()` + `SyncStatusBanner` / `SyncHealthToast` |
| `createOfflineMiddleware` / `configureOfflineMutationEndpoints` | Delete; the outbox replays every write |

```typescript
import {generateMutationId} from "@terreno/syncdb";
import {useMutate, useQuery} from "@terreno/syncdb/react";

const todos = useQuery<Todo>("todos", {where: {completed: false}, sort: "-created"});
const {create, update, remove} = useMutate("todos");

create({data: {_id: generateMutationId(), title, completed: false}});
update({id, data: {completed: true}});
remove({id});
```

Client-minted `_id`s let the optimistic row render before the server acknowledges it.
Rejected writes surface as conflicts in `useConflicts()` (resolve with `useServer` or
`keepMine`) or as `failedCount` in `useSyncStatus()`. `paused: "auth"` means replay waits for
the same user to sign back in; wire `SyncStatusBanner` `onAuthRequired` to the login flow.
Example: `example-frontend/components/SyncTodosScreen.tsx`.

| Event | Local store and outbox |
|-------|------------------------|
| 401 or expired session | Kept; replay resumes after the same user signs in |
| `useSession().logout()` with `wipeOnSignOut: true` | Wiped |
| A different user signs in | Wiped |
| Schema version mismatch or web decrypt failure | Wiped and re-bootstrapped |

## 8. Update ui and admin call sites

| 57.x | 58 |
|------|----|
| `<ConsentNavigator api={terrenoApi}>` | `<ConsentNavigator client={apiClient}>` |
| `<AnnouncementNavigator api={terrenoApi} …>` | `<AnnouncementNavigator client={apiClient} …>` |
| `useConsentForms(api, baseUrl)`, `useSubmitConsent(api, baseUrl)`, `useAnnouncements(api, …)`, `useAcknowledgeAnnouncement(api, …)` | Same hooks with `client` as the first argument |
| `useServerStatus()` → `OfflineBanner` | `useSyncStatus()` → `OfflineBanner queueLength={queuedCount}` |
| Admin `api` prop, `useAdminApi(api, …)` | Removed; see [Admin no longer takes an RTK `api`](https://github.com/TerrenoLabs/terreno/blob/master/mcp-server/src/docs/upgrades/58.0.0.md#admin-no-longer-takes-an-rtk-api) |
| `getAdminAuthHeaders` from `@/store/betterAuthApi` | `() => authProvider.getToken()` as a Bearer header, passed to `AdminProvider` `getAuthHeaders` |

## 9. Verify

```bash
rg -l "@terreno/rtk|@reduxjs/toolkit|react-redux|redux-persist|rtk-query" --glob '!**/node_modules/**' .
bun run compile && bun run lint && bun test
```

The search returns nothing. Then sign in, open each screen that read or wrote data, sign out,
and sign in as a second user.

## Every removed export

Every export of `@terreno/rtk` 57.x and its 58 replacement. Paths: `api` =
`@terreno/syncdb/api`, `app` = `@terreno/syncdb/app`, `auth` = `@terreno/syncdb/auth`,
`config` = `@terreno/syncdb/config`, `flags` = `@terreno/syncdb/flags`, `react` =
`@terreno/syncdb/react`, root = `@terreno/syncdb`.

### Request client and generated SDK (`emptyApi`, `tagGenerator`, `mongooseSlice`, `sessionApi`)

| Removed | Replacement |
|---------|-------------|
| `emptySplitApi` | `createApiClient` (api) + `ApiClientProvider` (react) |
| `getBaseQuery`, `staggeredBaseQuery` | `createApiClient` (api): auth header, 401 → refresh → retry, timeout |
| `useGetVersionCheckQuery`, `useLazyGetVersionCheckQuery` | `useUpgradeCheck` (app), or the generated `useGetVersionCheckQuery` in `store/apiSdk.ts` |
| `VersionCheckResponse` | `VersionCheckResponse` (app) |
| `refreshAuthToken` | `authProvider.refresh()` |
| `getTokenExpirationTimes`, `shouldShowStillThereModal` | Same names (auth), JWT apps only |
| `getFriendlyExpirationInfo` | Removed (debug string). Use `getTokenExpirationTimes` (auth). |
| `generateTags` | Removed. Codegen derives `providesTags` / `invalidatesTags` from OpenAPI tags. |
| `ListResponse`, `populateId` | Removed. List envelopes keep `{data, more, page, total}`; generated `<Name>Res` types describe them. |
| `createSessionApi` | Removed (no consumers). Use `createApiClient` (api). |

### Session and auth (`authSlice`, `betterAuthSlice`, `betterAuthClient`, `betterAuthTypes`)

| Removed | Replacement |
|---------|-------------|
| `createBetterAuthClient`, `BetterAuthClient` | Same names (auth) |
| `createStorageAdapter`, `StorageAdapter`, `repairCookieJar`, `withCookieJarRepair` | Same names (auth) |
| `BetterAuthClientConfig`, `BetterAuthUser`, `BetterAuthSession`, `BetterAuthSessionData`, `BetterAuthOAuthProvider` | Same names (auth) |
| `BetterAuthClientInterface` | `BetterAuthSessionClientLike` (auth) |
| `generateBetterAuthSlice`, `BetterAuthSlice`, `GenerateBetterAuthSliceConfig`, `BetterAuthState` | `SessionProvider` + `useSession()` (auth); `createSessionStore` for non-React code |
| `selectBetterAuthState`, `selectBetterAuthIsAuthenticated`, `selectBetterAuthUserId`, `selectBetterAuthUser`, `selectBetterAuthIsLoading`, `selectBetterAuthError` | `useSession()` → `{isAuthenticated, userId, user, isLoading, error}` |
| `generateAuthSlice` (JWT) | `jwtAuthAdapter` + `SessionProvider source={adapter}` + `useJwtAuth({adapter})` (auth) |
| `generateProfileEndpoints` | Generated `useGetAuthMeQuery` / `usePatchAuthMeMutation` in `store/apiSdk.ts` |
| `EmailLoginRequest`, `EmailSignupRequest`, `GoogleLoginRequest`, `ResetPasswordRequest` | Same names (auth) |
| `UserResponse` | `JwtAuthResponse` (auth) |
| `selectCurrentUserId`, `useSelectCurrentUserId` | `useSession().userId` |
| `selectIsAuthenticating`, `useSelectIsAuthenticating` | `useJwtAuth().isAuthenticating` / `useSession().isLoading` |
| `selectLastTokenRefreshTimestamp` | Removed. Subscribe with `authProvider.onAuthChange`. |
| `getAuthToken` | `authProvider.getToken()` |
| `LOGOUT_ACTION_TYPE`, `TOKEN_REFRESHED_SUCCESS` | Removed (Redux action types). Use `SessionProvider` `onLogout` and `authProvider.onAuthChange`. |
| `RootState` | Removed (no Redux store) |
| `AUTH_DEBUG`, `logAuth` | Removed. Set `createSyncDb({debug})` for sync and auth-pause events. |

### Config and platform (`constants`, `platform`)

| Removed | Replacement |
|---------|-------------|
| `baseUrl`, `baseWebsocketsUrl`, `baseTasksUrl` | Same names (config) |
| `resolveBaseUrls`, `resolveDevApiPort`, `BaseUrls`, `ExpoConstantsShape`, `SAME_ORIGIN_SENTINEL`, `DEFAULT_DEV_API_PORT` | Same names (config) |
| `IsWeb` | `isWeb` (config) or `Platform.OS === "web"` |
| — | New: `appHeaders()` (config) sends `App-Version` and `App-Platform` |

### Sockets and realtime (`socket`, `useRealtimeDebug`, `constants`)

| Removed | Replacement |
|---------|-------------|
| `useSocketConnection`, `SocketConnection`, `UseSocketConnectionOptions` | The `createSyncDb` socket; `useSocketEvent` (react) and `syncDb.onSocketEvent` (root) |
| `useRealtimeDebug`, `setRealtimeDebug`, `isWebsocketsDebugEnabled`, `logSocket` | `createSyncDb({debug})`, `useSyncDebugLog` (react), terreno-mcp-local `get_syncdb_state` |

### Feature flags (`useFeatureFlags`, `useTerrenoFeatureFlags`)

| Removed | Replacement |
|---------|-------------|
| `useFeatureFlags(api, options)`, `UseFeatureFlagsOptions` | `useFeatureFlags({client, skip, socket, userId})`, `UseFeatureFlagsOptions` (flags) |
| `resolveFeatureFlagsOptions` | Removed. Options are one object. |
| `useTerrenoFeatureFlags(api, options)`, `UseTerrenoFeatureFlagsOptions`, `UseTerrenoFeatureFlagsResult` | `useTerrenoFeatureFlags({client, skip, socket, userId})` and the same types (flags) |
| `TerrenoFlagDefinition`, `TerrenoFlagConfiguration` | Same names (flags) |
| `FlagsApi` | Removed. Pass an `ApiClient` as `client`. |

### Offline queue (`offlineSlice`, `offlineMiddleware`, `offlineGate`, `useOfflineStatus`, `useServerStatus`)

| Removed | Replacement |
|---------|-------------|
| `offlineSlice`, `offlineReducer`, `setOnlineStatus`, `enqueue`, `dequeue`, `clearQueue`, `addConflict`, `dismissConflict`, `clearConflicts`, `setSyncing` | The syncdb outbox. Write with `useMutate`; conflicts in `useConflicts()` (react). |
| `OfflineState`, `QueuedMutation`, `ConflictRecord` | `SyncStatus` from `useSyncStatus()`; conflicts from `useConflicts()` / `listConflicts` (root) |
| `selectIsOnline`, `selectIsOnlineSafe`, `selectOfflineQueue`, `selectQueueLength`, `selectConflicts`, `selectUndismissedConflicts`, `selectIsSyncing` | `useSyncStatus()` → `{isOnline, queuedCount, conflictCount, failedCount, isSyncing}` and `useConflicts()` |
| `createOfflineMiddleware`, `OfflineMiddlewareConfig`, `isNetworkFetchError`, `shouldReplayQueuedMutation`, `buildOptimisticCreateItem` | Removed. syncdb applies writes locally and replays the outbox. |
| `configureOfflineMutationEndpoints`, `shouldDeferOfflineMutation` | Removed. Every syncdb write is queued. |
| `useOfflineStatus`, `OfflineStatus`, `useServerStatus`, `ServerStatus`, `ServerStatusOptions` | `useSyncStatus()` (react) |

### App utilities (`useUpgradeCheck`, `usePermissions`, `devConsoleLogger`, `devStore`, `useMCPTools`, `useTerrenoChat`, `buildNumber`)

| Removed | Replacement |
|---------|-------------|
| `useUpgradeCheck` | `useUpgradeCheck` (app); runs on the request client from `ApiClientProvider` |
| `hasPermission`, `canOpenAdminPage`, `PermissionSet`, `PermissionRequest`, `ADMIN_PAGE_RESOURCE`, `ADMIN_PAGE_ACTION`, `ADMIN_PAGE_PERMISSION` | Same names (app) |
| `createPermissionSelectors`, `selectPermissions`, `useSelectPermissions`, `useCan`, `DEFAULT_PERMISSION_API_REDUCER_PATH` | Removed. Read `permissions` from `useGetAuthMeQuery()` and call `hasPermission` (app). |
| `installTerrenoDevConsoleLogger` | `installDevConsoleLogger` (app) |
| `resetTerrenoDevConsoleLoggerForTests` | Removed from the public API |
| `registerTerrenoDevStore` | Removed. `createSyncDb({debug})` registers the client for terreno-mcp-local (`get_syncdb_state`, `syncdb_snapshot`, `syncdb_action`). |
| `useMCPTools`, `MCPToolInfo`, `UseMCPToolsOptions`, `UseMCPToolsResult` | Same names (app); pass `authProvider` |
| `useTerrenoChat`, `UseTerrenoChatOptions` | Removed (no consumers). Use `useChat` from `@ai-sdk/react` with a bearer header from `authProvider.getToken()`, or `GPTChat` from `@terreno/ui`. |
| `@terreno/rtk/buildNumber`: `coerceBuildNumber`, `resolveBuildNumber` | `@terreno/syncdb/buildNumber` (node-only) |

### Removed before 58

`realtimeList`, `realtimeDocument`, `setRealtimeSocket`, `getRealtimeSocket`,
`useSyncConnection`, and `RealtimeEvent` went with the legacy RTK realtime path. See
[Legacy RTK realtime is removed](https://github.com/TerrenoLabs/terreno/blob/master/mcp-server/src/docs/upgrades/58.0.0.md#legacy-rtk-realtime-is-removed).

## Further reading

- [`@terreno/syncdb` reference](../reference/syncdb.md)
- [Local-first data](../explanation/local-first-data.md)
- [Configure Better Auth](configure-better-auth.md)
- [Use syncdb correctly](use-syncdb-correctly.md)
