# @terreno/syncdb

Local-first data layer for Terreno frontends. A TinyBase `MergeableStore` on device is the UI source of truth: reads come from the local store, writes apply optimistically into a durable outbox, and the server reconciles asynchronously over a socket delta protocol with HTTP snapshot catch-up. It is also the frontend's request client, session, feature-flag, and app-utility layer; Terreno 58 removed `@terreno/rtk` and Redux ([upgrade guide](../how-to/migrate-rtk-to-syncdb.md)).

## Table of Contents

- [Installation](#installation)
- [Architecture](#architecture)
- [Backend setup](#backend-setup)
- [createSyncDb configuration](#createsyncdb-configuration)
- [SyncDb client methods](#syncdb-client-methods)
- [React hooks](#react-hooks)
- [Query windows](#query-windows)
- [API client](#api-client)
- [Config](#config)
- [Auth](#auth)
- [App utilities](#app-utilities)
- [Feature flags](#feature-flags)
- [Codegen](#codegen)
- [Conflict API](#conflict-api)
- [Sync status API](#sync-status-api)
- [Stream scoping](#stream-scoping)
- [Sync protocol](#sync-protocol)
- [Encryption at rest](#encryption-at-rest)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Conventions](#conventions)

## Key exports

- `createSyncDb`, `SyncDb`, `SyncDbConfig`, `MutateArgs`
- `betterAuthAdapter`, `bridgeBetterAuthReactClient`, `AuthProvider`
- `listConflicts`, `wipeLocalData`, `generateMutationId`
- Queries: `QueryFieldNotAllowedError`, `ListRequestError`, `WhereFilter`, `SortSpec`, `WindowQuery`, `QueryWindowState`, `QueryWindows`, `compileWhere`, `DEFAULT_WINDOW_PAGE_SIZE`
- React (`@terreno/syncdb/react`): `SyncDbProvider`, `useEntity`, `useQuery`, `useEntityIds`, `useWindowQuery`, `useMutate`, `useSyncStatus`, `useConflicts`, `useSyncDebugLog`, `createCollectionHooks`, `ApiClientProvider`, `useApiClient`, `useApiQuery`, `useLazyApiQuery`, `useApiMutation`, `useSocketEvent`
- API client (`@terreno/syncdb/api`): `createApiClient`, `ApiClient`, `ApiError`, `isApiError`, `apiFetch`, `unwrapEnvelope`, `serializeParams`
- Config (`@terreno/syncdb/config`): `baseUrl`, `baseWebsocketsUrl`, `baseTasksUrl`, `appHeaders`, `isWeb`, `resolveBaseUrls`, `resolveDevApiPort`, `SAME_ORIGIN_SENTINEL`
- Auth (`@terreno/syncdb/auth`): `createBetterAuthClient`, `createStorageAdapter`, `repairCookieJar`, `withCookieJarRepair`, `SessionProvider`, `useSession`, `useSessionStore`, `createSessionStore`, `betterAuthSessionSource`, `betterAuthAdapter`, `bridgeBetterAuthReactClient`, Better Auth types; JWT (legacy): `jwtAuthAdapter`, `useJwtAuth`, `getTokenExpirationTimes`, `shouldShowStillThereModal`, `createJwtTokenStorage`, `readJwtTokens`, `decodeJwtClaims`
- App (`@terreno/syncdb/app`): `useUpgradeCheck`, `hasPermission`, `canOpenAdminPage`, `ADMIN_PAGE_PERMISSION`, `installDevConsoleLogger`, `useMCPTools`
- Flags (`@terreno/syncdb/flags`): `useFeatureFlags`, `useTerrenoFeatureFlags`, `TerrenoFlagConfiguration`
- Build number (`@terreno/syncdb/buildNumber`, node-only): `resolveBuildNumber`, `coerceBuildNumber`
- CLI: `terreno-syncdb-codegen` (generates `SYNC_COLLECTIONS` + friendly hooks from OpenAPI)
- Testing (`@terreno/syncdb/testing`): `createFakeTransport`
- Dev console logger: `installTerrenoDevConsoleLogger({baseUrl})` from `@terreno/syncdb`, also
  `@terreno/syncdb/devConsoleLogger`. In `__DEV__` it batches `console.error` / `console.warn`,
  React Native `ErrorUtils`, and web `window` errors to `POST {baseUrl}/__terreno/browser-logs`,
  which `read_logs` / `last_error` read back. An `ErrorUtils` error that the previous handler
  rethrows (the web default) is left to the `window` listeners, so a caught error is not logged.
  It does nothing outside `__DEV__`. Moved here from
  `@terreno/rtk`, which keeps a deprecated re-export.

## Installation

```bash
bun install @terreno/syncdb
```

**Peer dependencies:** `react` (optional — only for `@terreno/syncdb/react`), `luxon`, `tinybase`.

**Native persistence:** install `expo-sqlite` in the **app** (not only in a library):

```bash
bunx expo install expo-sqlite
```

Expo autolinking walks the app's own dependencies; a nested copy leaves the native module out of the build. Rebuild the native project after adding it.

**Why `@terreno/syncdb/react` is a separate subpath:** `react` is an optional peer dependency. Keeping React bindings off the main entry lets non-React consumers (Node tests, scripts) import `@terreno/syncdb` without loading React.

## Architecture

```
        FRONTEND (@terreno/syncdb)                 BACKEND (@terreno/api)
┌───────────────────────────────────┐      ┌────────────────────────────────────┐
│ React hooks (useQuery, useEntity, │      │ modelRouter(path, Model, {sync})   │
│ useMutate, useSyncStatus, ...)    │      │  └─ sync registry + validation     │
│        │            ▲             │      │                                    │
│        ▼            │             │      │ syncPlugin (schema)                │
│ TinyBase MergeableStore           │      │  └─ stamps _syncSeq per write      │
│  {collection} tables + _outbox    │      │                                    │
│  + _cursors + _conflicts          │      │ SyncApp (HTTP)     RealtimeApp     │
│        │            ▲             │      │  /sync/snapshot     (Socket.io +   │
│        ▼            │             │      │  /sync/mutate       change streams)│
│ Persister (AES-GCM IndexedDB on   │      │  /sync/key              │          │
│ web, expo-sqlite on native)       │      └─────────┬───────────────┼──────────┘
└──────┬─────────────────▲──────────┘                │               │
       │                 │                           │               │
       │   sync:mutate ─────────────────────────────►│               │
       │   sync:ack / sync:nack ◄────────────────────┘               │
       │   sync:delta ◄──────────────────────────────────────────────┘
       │   POST /sync/snapshot/batch (bootstrap + catch-up, HTTP)
       └── POST /sync/mutate (fallback while the socket is down)
```

Every mutation executes the same `@terreno/api` modelRouter write path as REST — identical permissions, hooks, and validation.

## Backend setup

Register sync on the backend before the frontend client can sync a collection.

### Required schema plugins

```typescript
import {isDeletedPlugin, syncPlugin} from "@terreno/api";

todoSchema.plugin(isDeletedPlugin); // soft delete — required for tombstone catch-up
todoSchema.plugin(syncPlugin);      // stamps per-stream _syncSeq on every write
```

Apply plugins **before** the model compiles. Registration validates their presence.

`_syncSeq` and `_syncPrevStream` are server-owned. modelRouter create and update (REST, MCP
tools, and sync mutations) drop them from the client body, and a save that changes only these
fields gets a freshly claimed seq instead of keeping the value it was given.

### modelRouter sync config

Use the three-argument `modelRouter` form:

```typescript
import {modelRouter, OwnerQueryFilter, Permissions} from "@terreno/api";

const todoRouter = modelRouter("/todos", Todo, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsOwner],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
  },
  preCreate: (body, req) => ({...body, ownerId: (req.user as unknown as UserDocument)?._id}),
  queryFilter: OwnerQueryFilter,
  sync: {
    scope: {type: "owner"}, // stream = todos|owner:{ownerId}
    // adminBroadcast: true, // also emit sync:delta to todos|admin (default false)
  },
});
```

### SyncApp and RealtimeApp

```typescript
import {RealtimeApp, SyncApp, TerrenoApp} from "@terreno/api";

new TerrenoApp({userModel: User})
  .register(todoRouter)
  .register(new SyncApp())      // GET /sync/snapshot, POST /sync/mutate, GET /sync/key, ...
  .register(new RealtimeApp())  // Socket.io; sync:subscribe, sync:delta, sync:mutate
  .start();
```

- **`SyncApp`** — HTTP sync routes (`/sync/snapshot`, `/sync/mutate`, `/sync/mutate/batch`, `/sync/key`, `/sync/streams`, `/sync/entities`).
- **`RealtimeApp`** — Socket.io server with change-stream-driven `sync:delta` emission. Requires a **MongoDB replica set** (change streams). `modelRouter` `realtime` and its RTK `sync` events were removed in Terreno 58; `sync:delta` is the only collection event.
- **`ensureSyncIndexes`** — `TerrenoApp.start()` binds the HTTP port first (or attaches to `httpServer` if the process already listened), then awaits index builds for snapshot queries and sync bookkeeping (`SyncMutation.mutationId` unique, `SyncCounter.stream` unique, etc.). Registration queues this work without contacting MongoDB, so models can load before the database connects. Hosts that build Express without `TerrenoApp.start()` should await `ensureSyncIndexes()` after connecting.

Socket auth requires at least one configured authentication method. It enables legacy JWT
validation when `tokenSecret` or `TOKEN_SECRET` is available. When a `BetterAuthApp` is
registered on the same `TerrenoApp`, `RealtimeApp` validates Better Auth sessions with its
instance automatically, with or without a JWT secret. The handshake creates the app `User` on
first contact and refuses disabled users. A `RealtimeApp` without its own `userModel` uses the
`TerrenoApp`'s, for JWT and Better Auth sockets alike: socket authorization reads the user from
the database instead of the token's claims, and the revalidation sweep disconnects users who
were disabled or deleted. With a user model, the JWT handshake also refuses a token whose user
is disabled or no longer exists, so a disconnected client cannot reconnect with the same token.
Pass `betterAuth` only for a `RealtimeApp` mounted without
`TerrenoApp`:

```typescript
new RealtimeApp({betterAuth: {auth, userModel: User}})
```

When both methods are configured, JWT validation runs first and Better Auth session validation
is the fallback.

## createSyncDb configuration

```typescript
import {betterAuthAdapter, bridgeBetterAuthReactClient, createSyncDb} from "@terreno/syncdb";

export const syncDb = createSyncDb({
  name: "myapp",
  collections: ["todos"],
  authProvider: betterAuthAdapter(bridgeBetterAuthReactClient(authClient)),
  baseUrl: "http://localhost:4000",
});
```

Wrap a Better Auth **react** client in `bridgeBetterAuthReactClient`. Its `useSession` is a React
hook rather than the `.subscribe` surface the adapter watches, so without the bridge the adapter
falls back to polling `getSession()` and produces constant `/api/auth/get-session` traffic. The
bridge exposes the client's `$store.atoms.session` atom and degrades to the polling fallback when
that atom is absent. Clients that already expose `getSession` plus a subscribable `useSession` can
be passed to `betterAuthAdapter` directly.

`betterAuthAdapter(client, options)` options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `getBearerToken` | `() => string \| null` | — | Reads a locally stored session token. When it returns a token, `getToken` uses it and skips `getSession()`. A null or empty result, or a throw, falls back to `getSession()`. `getUserId`, `onAuthChange` and `refresh` always read the session. |
| `pollIntervalMs` | `number` | `5000` | Polling cadence when the client has no subscribable session |
| `setIntervalFn` / `clearIntervalFn` | test hooks | global timers | Inject timers for deterministic tests |

For a web app in Better Auth bearer mode (`createBetterAuthClient({webAuth: "bearer"})`), pass
`getBetterAuthBearerToken` from `@terreno/syncdb/auth` so every sync and request-client call
reads the stored token without a `get-session` round trip:

```typescript
import {betterAuthAdapter, bridgeBetterAuthReactClient} from "@terreno/syncdb";
import {getBetterAuthBearerToken} from "@terreno/syncdb/auth";

const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(authClient), {
  getBearerToken: () => getBetterAuthBearerToken({storagePrefix: "myapp"}),
});
```

Pass the same `storagePrefix` and `bearerStorage` you gave `createBetterAuthClient`. The option
is explicit: the adapter never detects bearer mode from the client.

The adapter never throws on a failed session read (a rejected `getSession()`, or a `{error}`
envelope other than a 401). `getToken` and `refresh` answer null and false. `getUserId` answers
with the user id the server last confirmed, through a successful read or a session-atom
emission, and null before the first confirmation. A read that fails while the device is offline
is therefore never reported as a sign-out, which would clear the client's current user and make
`mutate()` throw. A successful read with no session, or a 401 (from `getSession()` or the session
atom), is a sign-out; a 401 emission also fires `onAuthChange`, deduped like any other
signed-out emission.

The last confirmed user id follows the newest answer, not the last one to arrive. A read counts
from when it started; an emission that changes or clears the identity counts from when it
arrived. A read that started before a sign-out or user switch and resolves after it still
answers its own caller, but does not update the confirmed user id. Emissions that repeat the
atom's cached session are not new answers: a refetch-start emission (`isRefetching: true`) is
ignored, and the value a new subscriber receives on subscribing only fills the confirmed user id
before anything else has confirmed one.

`createSyncDb(options)` options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — (required) | Persisted database name |
| `collections` | `string[]` | — (required) | Collection names to sync (local tables + subscriptions) |
| `windowCollections` | `string[]` | `[]` | Collections that join `{collection}\|admin`, skip snapshots/reconcile, and hydrate only known REST membership ids |
| `queryCollections` | `Array<string \| {collection, path?, fullSync?}>` | `[]` | Collections too large to sync whole (or `fullSync: true` to keep snapshot sync and add windows). No snapshot/reconcile paging; rows arrive through [query windows](#query-windows) against the `modelRouter` list endpoint (`path`, default `/{collection}`) plus live deltas on the user's normal streams. Each entry must also be in `collections` and not in `windowCollections`. |
| `organizationIdProvider` | `() => string \| undefined` | — | Read at send time: sets `X-Organization-Id` on HTTP sync calls and `organizationId` on socket mutate payloads |
| `authProvider` | `AuthProvider` | — (required) | `{getToken, getUserId, onAuthChange, refresh?}` |
| `baseUrl` | `string` | — | Server origin; required unless both `transport` and `httpChannel` are injected |
| `transport` | `SyncTransport` | socket transport from `baseUrl` | Override for tests or custom wiring |
| `socketTransports` | `string[]` | `["polling", "websocket"]` | Socket.IO transports for the default socket transport. Use `["websocket"]` on hosts without session affinity, such as Vercel Functions ([details](../how-to/vercel-function-websockets.md)) |
| `httpChannel` | `HttpChannel` | built from `baseUrl` | HTTP fallback channel override |
| `persisterFactory` | `PersisterFactory` | platform default (IndexedDB web, expo-sqlite native) | Storage backend override |
| `keyProvider` | `KeyProvider` | server-derived via `GET /sync/key` | Web encryption key provider |
| `idbGetImpl` / `idbSetImpl` | test hooks | — | Simulate IndexedDB failures (tests only) |
| `reconcileIntervalMs` | `number` | `300000` (5 min); `0` disables | Periodic reconcile + outbox replay timer |
| `seqJumpReconcileMinIntervalMs` | `number` | `30000` (30s) | Per-stream rate limit for seq-jump-triggered reconciles |
| `now` | `() => number` | `Date.now` | Injectable clock (tests) |
| `random` | `() => number` | `Math.random` | Injectable RNG for backoff jitter (tests) |
| `debug` | `boolean \| SyncDebugLogOptions` | `false` | In-memory debug event log |
| `onAuthRequired` | `() => void` | — | Fires once per auth-pause episode (prompt re-login) |
| `wipeOnSignOut` | `boolean` | `false` | `signOut()` also wipes local data |
| `batchSize` | `number` | `50` (server caps at 100) | Max mutations per batched drain send |
| `haltQueueOnConflict` | `boolean` | `false` | `true` = conflict halts entire drain; `false` = per-entity blocking |
| `snapshotConcurrency` | `number` | `6` | Streams paged at once with `GET /sync/snapshot`: by `forceResync`, and by every other pass against a server without `POST /sync/snapshot/batch`. Each stream runs one pass at a time. `1` pages one stream at a time |
| `onDecryptFailure` | `() => void` | wipe + re-bootstrap (with `console.warn`) | Override web decrypt-failure recovery |
| `tombstoneRetentionMs` | `number` | `7776000000` (90 days); `0` disables | Client tombstone compaction after successful reconcile |
| `startAuthRetryAttempts` | `number` | `3`; `1` disables | `start()` attempts to resolve `getUserId()` |
| `startAuthRetryDelayMs` | `number` | `250` | Delay between those attempts |

`start()` needs an authenticated user. It retries `getUserId()` briefly (transient session races after login) before rejecting.

## SyncDb client methods

| Method | Description |
|--------|-------------|
| `start()` | Resolve user, run wipe-on-user-change check, start persistence, connect transport, subscribe collections, start reconcile timer. Resolves even when offline. Idempotent while already started. |
| `stop()` | Disconnect, flush and stop persistence, clear timers and listeners. Cancels a `start()` that is still running or queued ahead of it, so the transport never connects after logout. Auth changes that fired before the stop but had not run yet are dropped, so a stopped client never reconnects on its own (for example while the app signs out). A stream discovery (`GET /sync/streams`) that was still reading the token when `stop()` ran is not sent, so it never reaches the server with a session the app is signing out of. |
| `goOffline()` | Simulated outage: disconnect transport, pause replay/reconcile/timer; local mutations keep queueing. |
| `goOnline()` | End simulated outage; reconnect triggers reconcile + outbox replay. |
| `mutate({collection, operation, id?, data?})` | Optimistic local write + durable outbox enqueue + fire-and-forget replay. Returns `{mutationId, id}`. |
| `reconcile()` | HTTP snapshot catch-up for every known stream, batched into `POST /sync/snapshot/batch` rounds (see [Snapshot bootstrap](#snapshot-bootstrap)); runs tombstone compaction on success. Also runs automatically on (re)connect, on a rate-limited seq-jump hint, and on the periodic timer; `sync:subscribed` confirmations additionally page just the streams they name, and confirmations arriving while that catch-up request is in flight are paged together in the next one. |
| `hydrateWindow({collection, ids, restRows?})` | Admin window upsert: REST rows (optional) land immediately; every requested id is also fetched from `GET /sync/entities` before this resolves so seq/deleted metadata is canonical for immediate update/delete. A `{collection}|admin` delta that lands while the fetch is in flight wins, so hydration never rewinds a row to an older seq. Unknown ids are ignored. |
| `queryWindows` | Server query windows for `queryCollections`: `fetchWindow({query, nextPage?})`, `getWindow(query)`, `retain(query)` → release, `refetchRetained()`, `pruneUnretained()`, `subscribe(cb)`, `keyFor(query)`. See [Query windows](#query-windows). |
| `forceResync()` | Purge every known stream locally and re-bootstrap from cursor 0 (outbox/conflicts untouched). Returns `{ok, reason?, streams, purged, repaired}`. After discovery and each stream bootstrap it waits for in-flight `start`/`stop`/auth-change work, then abandons with `reason: "superseded"` when that work switched users or generations. |
| `replayOutbox()` | Drain queued mutations for the current user now. |
| `resolveConflict({mutationId, strategy})` | Apply `"useServer"` or `"keepMine"` to a recorded conflict. |
| `retryFailed({entityId})` | Re-enable an entity's queued successors after a terminal validation failure. |
| `signOut()` | Explicit teardown like `stop()` (including cancelling an in-flight `start()`); wipes local data only when `wipeOnSignOut: true`. |
| `getSyncStatus()` | Snapshot of aggregate sync state (see [Sync status API](#sync-status-api)). |
| `onStatusChange(callback)` | Subscribe to connectivity/syncing changes; returns unsubscribe. |
| `onSocketEvent(event, handler)` | Listen for an app-level server event (for example `featureFlagsChanged`) on the sync socket; returns unsubscribe. Listeners survive `stop()`/`start()` and reconnects. `sync:*` and Socket.io lifecycle names throw. A transport without `onEvent` returns a no-op. |
| `store` | Read surface over the local MergeableStore (`SyncStore`). |
| `outbox` | Durable mutation outbox (`Outbox`). |
| `debug` | `SyncDebugLog` when `debug` is enabled; otherwise `undefined`. |

### Local MCP debugging

When `debug` is enabled, `createSyncDb` registers the client by `name` on the
development runtime bridge used by `terreno-mcp-local`. Production clients stay
unregistered when debug logging is off.

| Tool | Operations |
| --- | --- |
| `get_syncdb_state` | Read status, entities/tombstones, decoded outbox, conflicts, cursors, known streams, repair markers, values, and debug events |
| `syncdb_snapshot` | `capture`, `list`, `get`, `compare`, `delete` |
| `syncdb_action` | `mutate`, `setLocalEntity`, `deleteLocalEntity`, `flush`, `reconcile`, `forceResync`, `resolveConflict`, `retryFailed`, `goOffline`, `goOnline`, `clearDebug`, `mergeSnapshot` |

Read and snapshot tools redact sensitive field names. `syncdb_action` requires
the local MCP process to start with `TERRENO_MCP_EVAL=1`. `flush` means “drain
the durable outbox now.” `mergeSnapshot` CRDT-merges TinyBase mergeable content
from a snapshot retained in the same MCP process. Later HLCs win, including
deletes; it does not replace the live store. To force specific rows from a
capture, use `setLocalEntity` from `syncdb_snapshot` `get`.

See [Debug a Terreno app with MCP](../how-to/debug-with-mcp.md).

## React hooks

Import from `@terreno/syncdb/react`:

```typescript
import {
  createCollectionHooks,
  SyncDbProvider,
  useConflicts,
  useEntity,
  useEntityIds,
  useMutate,
  useQuery,
  useSyncDbClient,
  useSyncDebugLog,
  useSyncStatus,
} from "@terreno/syncdb/react";
```

Wrap the app (or a subtree) in `SyncDbProvider`:

```tsx
<SyncDbProvider client={syncDb}>
  <TodoList />
</SyncDbProvider>
```

### `useEntity(collection, id)`

```typescript
const {data, deleted, seq, isPending} = useEntity<Todo>("todos", id);
```

Subscribe to a single entity. Re-renders when that row changes. `isPending` is true while an outbox mutation protects optimistic state.

### `useQuery(collection, options?)`

```typescript
const todos = useQuery<Todo>("todos", {
  where: {completed: false, created: {$gte: since}},
  sort: "-created",
  limit: 20,
});

// Callbacks still work and combine with `where`:
const mine = useQuery<Todo>("todos", {filter: (t) => t.ownerId === userId, sort: byCreatedDesc});
```

Returns decoded entity data arrays from the local store. Tombstones excluded unless `includeDeleted: true`.

| Option | Type | Description |
|--------|------|-------------|
| `where` | `WhereFilter` | Mongo-style filter: equality, dot paths, `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin` `$exists`, `$and` / `$or`. An array field matches when any element equals the value. Compared by value, so inline objects are fine. Throws for operators only the server can run (`$search`, `$regex`). |
| `filter` | `(data) => boolean` | Arbitrary predicate, applied after `where`. |
| `sort` | `SortSpec \| comparator` | `"-created name"`, `{created: "descending"}`, or `(a, b) => number`. |
| `limit` | `number` | Keep the first N rows after filter and sort. |
| `includeDeleted` | `boolean` | Include tombstones. |

Filter and sort run in JS — memoize `filter`/comparator callbacks when collections are large.

### `useEntityIds(collection, options?)`

```typescript
const ids = useEntityIds<Todo>("todos", {filter: (t) => !t.completed, sort: byCreatedDesc});
return ids.map((id) => <TodoRow key={id} id={id} />);
```

Same options as `useQuery`, but returns only ordered ids with **referential stability** — the array identity changes only when membership or order changes, not on field updates. Pair with per-row `useEntity` for large lists.

### `useWindowQuery(collection, options?)`

```typescript
const {data, isLoading, isFetching, hasMore, fetchNextPage, refetch, total, error} =
  useWindowQuery<Message>("messages", {
    where: {threadId, deleted: false},
    sort: "-created",
    pageSize: 30,
  });
```

Server-filtered list over a `queryCollections` collection. See [Query windows](#query-windows).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `where` | `WhereFilter` | — | Sent as qs list params (`status[$in][0]=open`). Fields must be in the route's `queryFields`. |
| `sort` | `SortSpec` | route default | Server `sort`; also orders the local view. |
| `pageSize` | `number` | `50` | Server `limit` per page (capped by the route's `maxLimit`). |
| `skip` | `boolean` | `false` | Do not retain or fetch (e.g. a required param is missing). |
| `liveMatch` | `boolean` | `true` | Show cached rows that newly match `where` inside the loaded range. |

| Result | Description |
|--------|-------------|
| `data` / `ids` | This window's rows in view order. |
| `isLoading` | No membership yet (first fetch in flight). Cached membership renders with `isLoading: false`. |
| `isFetching` | Any request for this window is in flight. |
| `isError` / `error` | Last request failed (cached rows still render). |
| `errorCode` | Server error code of the last failure; `"query-param-not-allowed"` means a `where` field is missing from `queryFields`. |
| `hasMore` / `total` | From the list response's `more` / `total`. |
| `fetchNextPage()` | Append the next server page. |
| `refetch()` | Reload every loaded page in one request, replacing membership. |

### `useMutate(collection)`

```typescript
const {create, update, remove} = useMutate("todos");

const {id, mutationId} = create({data: {title: "Milk", completed: false}});
update({id, data: {completed: true}});
remove({id});
```

Each call applies locally, enqueues in the outbox, and kicks off replay.

### `useSyncStatus()`

```typescript
const status = useSyncStatus();
// status.isOnline, status.isSyncing, status.queuedCount, status.conflictCount, ...
```

Reactive aggregate status; re-renders on outbox, conflict, cursor, connectivity, and drain-progress changes.

### `useConflicts()`

```typescript
const {conflicts, resolve} = useConflicts();
resolve({mutationId, strategy: "useServer"});
resolve({mutationId, strategy: "keepMine"});
```

### `useSyncDebugLog()`

```typescript
const {enabled, events, stats, log, clear} = useSyncDebugLog();
```

Available when the client was created with `debug: true`. `log?.snapshot()` returns a JSON-serializable object suitable for debug UIs or tooling.

### `useSyncDbClient()`

Returns the `SyncDb` instance from context (escape hatch for imperative calls like `forceResync()`).

### `useSocketEvent(event, handler, options?)`

Binds `handler` to a server socket event while mounted, through `onSocketEvent` on the
`SyncDbProvider` client. The latest handler always runs; the listener is rebound only when
`event`, `client`, or `enabled` changes. Options: `client` (a `SyncDb`, or `null` to listen to
nothing; required outside a provider) and `enabled` (default `true`). See
[WebSocket integration](../how-to/websocket-integration.md).

```typescript
useSocketEvent("announcementPublished", () => {
  void refetch();
});
```

### `createCollectionHooks`

Factory used by `terreno-syncdb-codegen` and by hand-written custom collections. Returns six operation hooks (`useListQuery`, `useWindowQuery`, `useReadQuery`, `useCreateMutation`, `useUpdateMutation`, `useDeleteMutation`). Generated SDKs rename them to friendly names (`useTodos`, `useTodosWindow`, `useTodo`, `useCreateTodo`, …). `useWindowQuery` works only for collections listed in `queryCollections`. Mutation hooks return `[trigger]`; triggers apply locally and return `{mutationId, id}` synchronously. Optional `retries` maps to `maxAttempts` (`false` → 1, a number → that many, omitted → engine default).

```typescript
export const {useListQuery: useNotes, useCreateMutation: useCreateNote} =
  createCollectionHooks<Note, CreateNoteBody, UpdateNoteBody>({
    collection: "notes",
  });
```

## API client

Synced collections read and write through the local store. Every other route —
`/auth/me`, modelRouter actions, AI, consents, announcements, version check — goes
through the request client in `@terreno/syncdb/api`. It uses the same `AuthProvider` as
`createSyncDb`, so both send the same token and refresh it the same way.

```typescript
import {createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";

export const apiClient = createApiClient({
  authProvider,            // the provider passed to createSyncDb
  baseUrl,
  credentials: "include",  // "same-origin" for cookie SPAs
  headers: appHeaders,     // App-Version + App-Platform
});
```

Wrap the app in `<ApiClientProvider client={apiClient}>`, then:

```typescript
import {useApiMutation, useApiQuery} from "@terreno/syncdb/react";

const {data: me, isLoading, refetch} = useApiQuery<Profile>(
  {url: "/auth/me"},
  {providesTags: ["profile"], skip: !userId}
);
const [updateMe, {isLoading: isSaving}] = useApiMutation<UpdateProfile, Profile>(
  (body) => ({body, method: "PATCH", url: "/auth/me"}),
  {invalidatesTags: ["profile"]}
);
await updateMe({name: "Ada"}).unwrap();
```

| `createApiClient` option | Description |
|--------------------------|-------------|
| `baseUrl` | API origin; relative request URLs are prefixed with it |
| `authProvider` | `getToken` adds `Authorization: Bearer`; on a 401, `refresh` runs once and the request retries |
| `credentials` | Fetch credentials mode for cookie sessions |
| `headers` | Object or (async) function merged into every request |
| `timeoutMs` | Per-request timeout (default 30 000) |
| `onError` | Called with every `ApiError` after any retry (report to Sentry here) |
| `keepUnusedDataMs` | How long an unsubscribed cache entry survives (default 60 000) |

| Request arg | Description |
|-------------|-------------|
| `url`, `method` | Path (or absolute URL) and HTTP method (default `GET`) |
| `params` | Query params; arrays become repeated keys, nested objects bracket keys (`updated[$gte]`) |
| `body` | Plain objects are JSON-encoded; `FormData`, `Blob`, and strings pass through |
| `headers` | Per-request headers (part of the cache key) |
| `unwrap` | Unwrap `{data}` single-document envelopes (default `true`); list envelopes with `more` stay whole |
| `parseAs`, `timeoutMs`, `signal` | Response parsing, timeout, and cancellation |

| Client method | Description |
|---------------|-------------|
| `request(args)` | One uncached request |
| `fetchQuery(args, {providesTags, force})` | Cached request; identical in-flight calls share one fetch |
| `getQueryState(args)` / `subscribeQuery(args, listener)` | Read and watch one cache entry |
| `invalidateTags(tags)` | Refetch mounted queries with those tags; drop unmounted ones |
| `reset()` | Clear the cache; call when the signed-in user changes |

| Hook | Returns |
|------|---------|
| `useApiQuery(args \| null, {skip, providesTags, pollingInterval, transformResponse, client})` | `{data, error, isLoading, isFetching, isSuccess, isError, isUninitialized, refetch}` |
| `useLazyApiQuery({providesTags, client})` | `[trigger(args), state]`; each trigger fetches fresh data |
| `useApiMutation(toRequest, {invalidatesTags, client})` | `[trigger(arg), {data, error, isLoading, isSuccess, isError, reset}]` |

Triggers resolve `{data}` or `{error}`; `.unwrap()` resolves the data or throws.
Failures are `ApiError` (`status`, `data.title`, `data.detail`, `data.code`, `data.fields`,
`data.meta`); timeouts and network failures have `status: 0`. `data.disableExternalErrorTracking`
is `true` when the server marks the error as expected, so an `onError` reporter should skip
Sentry for it.

## Config

`@terreno/syncdb/config` resolves the app's API origin once at import (needs
`expo-constants`):

1. `extra.BASE_URL` set to `__SAME_ORIGIN__` resolves to the page origin (same-origin web SPAs).
2. `EXPO_PUBLIC_API_URL`, in any build.
3. `extra.BASE_URL` in `app.json` (production/staging builds only).
4. Expo `hostUri` plus the dev API port (simulator/device).
5. `http://localhost:<dev API port>`.

The dev API port is `4000` unless `EXPO_PUBLIC_DEV_API_PORT` or `extra.DEV_API_PORT` sets
it. `appHeaders()` returns `App-Version` (Expo config version) and `App-Platform`
(`web` or `mobile`).

## Auth

`@terreno/syncdb/auth` holds the Better Auth client and the session state that replace
`@terreno/rtk`'s `createBetterAuthClient` and Better Auth Redux slice. It needs the
optional peers `better-auth`, `@better-auth/expo`, `expo-secure-store`,
`@react-native-async-storage/async-storage`, and `react`.

```tsx
import {createBetterAuthClient, SessionProvider, useSession} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";

export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: "myapp",
  storagePrefix: "myapp",
});

<SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]} onLogout={() => apiClient.reset()}>
  <App />
</SessionProvider>;

const {userId, user, isLoading, isAuthenticated, isSigningOut, error, logout, refresh} =
  useSession();
```

`createBetterAuthClient({baseURL, scheme, storagePrefix?})` returns the Better Auth React
client with the Expo plugin. Storage is `expo-secure-store` (synchronous API) on native and
AsyncStorage on web. Reads of the plugin's cookie jar (`<storagePrefix>_cookie`) go through
`repairCookieJar`, which drops entries the plugin cannot read, so one malformed entry never
blocks every native request. `storagePrefix` defaults to `"terreno"`.

`SessionProvider` props (read once on mount):

| Prop | Type | Description |
|------|------|-------------|
| `authClient` | Better Auth client | Wrapped with `betterAuthSessionSource`. Use this or `source`. |
| `source` | `SessionSource` | Any session source (`getSession`, `signOut`, optional `subscribe`). |
| `store` | `SessionStore` | A store from `createSessionStore`, instead of the props above. Share it with non-React code. |
| `syncDbs` | `{signOut}[]` | syncdb clients signed out on `logout`, after the auth server confirms the sign-out and while the session still names the user. Create them with `wipeOnSignOut: true` to wipe local data. |
| `onLogout` | `() => void \| Promise<void>` | Extra cleanup after the auth and syncdb sign-outs. |
| `signOutTimeoutMs` | `number` | How long `logout` waits for the server's sign-out, and for the session check after a failed one. Default `10000`. |
| `pollIntervalMs` | `number` | Poll cadence when the source cannot push changes. Default `60000`; `0` turns polling off. |

When the session syncs:

- **Start:** the provider reads the session on mount. `isLoading` is `true` until it settles.
- **Sign-in, sign-out, user switch:** Better Auth's session atom (`$store.atoms.session`)
  pushes the change. Only settled emissions apply: while a read is in flight (`isPending` or
  `isRefetching`) the atom still carries the previous user, so a sign-out never briefly
  restores them. Call `refresh()` after a sign-in to resolve the user immediately.
- **Polling:** only when the client has no session atom.
- **Logout:** `logout()` signs out of the auth server while the session stays in the state
  (`isSigningOut` is `true`, `isLoading` is untouched), then signs out each `syncDbs` client,
  runs `onLogout`, and clears the session. The session stays until the server answers so a
  login screen that opens at once never finds the live session and signs straight back in, and
  so the sync clients still know the current user for their `wipeOnSignOut` wipe. A sign-out
  that fails or outlasts `signOutTimeoutMs` triggers a session check: when the session is
  still live (or the server cannot be asked and the client may still hold one), `logout()`
  keeps the session, wipes nothing, and sets `error` to `SIGN_OUT_FAILED_MESSAGE`; a session
  that is already gone clears normally. Session pushes during a logout are held, and a
  different user who signed in meanwhile wins when it ends. Concurrent `logout()` calls share
  one run. A failing `syncDbs` or `onLogout` step is logged and the rest still run.

A failed startup or `refresh()` read sets `error` to `"Failed to sync session"` and clears the
session. A failed background read (atom error, poll) keeps the current session, so a network
blip is never a logout. `useSession()` throws outside a `SessionProvider`.

`betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient))` turns the same client into
the `AuthProvider` for `createSyncDb` and `createApiClient`. Both are also exported from the
package root.

### Social login, account linking, and account security

`@terreno/syncdb/auth` also exports the pieces behind the example app's login and security
screens. They take a client from `createBetterAuthClient` (pass `features` to turn on the
`twoFactor`, `passkey`, `multiSession`, `lastLoginMethod` and `oneTimeToken` client plugins) and
need no store: session state comes from `useSession()`. Setup: [Configure Better
Auth](../how-to/configure-better-auth.md) and [Account security](account-security.md).

- `BetterAuthClient` — The client type without `features` (also `ReturnType<typeof createBetterAuthClient>`). `BetterAuthClientWithFeatures<Features>` — the client type with them. `BetterAuthClientFor<Features>` — which of the two `createBetterAuthClient` returns. `BetterAuthHandoffClient` — what the OAuth handoff helpers accept: any client from `createBetterAuthClient`
- `BetterAuthOAuthProvider` — `"google" | "github" | "apple"` or any generic OAuth provider id, such as `"mock-oidc"`
- `getBetterAuthBearerToken({storagePrefix?, bearerStorage?})` — Reads the token bearer mode stored, or `null`
- `signInSocialWithHandoff({client, provider, callbackURL?, errorCallbackURL?})` — Starts a social or generic OAuth sign-in for a web bearer client: stores a random nonce in `sessionStorage` and navigates the page to the server's `{basePath}/oauth-handoff/start` with `handoff=<nonce>` on the callback URLs. Throws on native and in cookie mode ([how-to](../how-to/configure-better-auth.md#social-sign-in-in-bearer-mode))
- `completeBetterAuthOAuthHandoff({client}): Promise<boolean>` — On the return page, removes `#ott` and `handoff` from the URL first, then exchanges the token at `{basePath}/one-time-token/verify` only when `handoff` matches the stored nonce. Resolves `true` only when a bearer token was stored; never rejects. Await it at startup before session reads and Sentry
- `linkSocialWithHandoff({client, provider, callbackURL, errorCallbackURL?}): Promise<{error}>` — Links a provider to the signed-in user. On web in bearer mode it posts the intent to `{basePath}/oauth-handoff/link-intent` with the bearer, then submits the returned single-use token in a hidden POST form to `startURL`, which redirects to the provider; the page comes back to `callbackURL` with no `#ott`. Both URLs may be any page on a web origin (`callbackPaths` do not apply); `errorCallbackURL` defaults to `callbackURL`. In cookie mode and on native it calls `client.linkSocial`. Resolves `{error: null}` once the browser is on its way, or `{error: {status, code?, message?}}` (such as 403 `LINKING_DISABLED`) without submitting anything. `BetterAuthLinkClient` is its client type ([how-to](../how-to/configure-better-auth.md#linking-a-provider-in-bearer-mode))
- `useAuthMethods(authClient, {skip?}): {methods, isLoading, error, refetch}` — Loads the server's enabled sign-in methods (`BetterAuthMethods`: `providers`, `emailPassword`, `signUp`, `accountLinking`, and feature flags) once per client from `{basePath}/terreno/methods` through the client's `$fetch`, so bearer and cookie modes both work. `methods` is `undefined` while loading and after an error; render no provider buttons until it arrives. `refetch()` requests them again (for Try again); `skip: true` makes no request ([response](api.md#better-auth-authentication))
- `createRememberedAccountsStore({rememberIdentity, storageKey?, max?, storage?})` — On-device store of accounts that signed in here, for the login screen. Returns `{record(entry), forget(userId), clear(), list(), lastUsedMethod(), isHydrated(), ready, getSnapshot(), subscribe(listener), dispose()}`. Each change re-reads storage first, and on web the store follows `storage` events for its key until `dispose()`, so a stale tab cannot bring back a forgotten account. A failed change rejects to its caller without blocking later changes. Persists `{userId, method, lastUsedAt}` (newest first, at most `max`, default 5, and at most 2048 bytes) under `storageKey` (default `terreno_remembered_accounts`) in SecureStore on native (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS) or localStorage on web. `rememberIdentity` is required: pass `false` to keep only the method. `name` (in clear), a masked `email`, and an `https://` `image` are kept only with `rememberIdentity: true`. Unreadable or oversized stored data resets to an empty list ([how-to](../how-to/configure-better-auth.md#4-remember-accounts-on-this-device))
- `useRememberedAccounts(store): {accounts, lastUsedMethod, isHydrated, forget, clear}` — Subscribes a component to the store. `isHydrated` is `false` until native storage has loaded
- `toLoginAccountOptions(accounts)` — Maps `RememberedAccount[]` to `@terreno/ui` `LoginAccountOption[]` (`id` is the `userId`) for `LoginScreen`'s `rememberedAccounts`
- `maskEmail(email)` — `josh@mail.flourish.health` → `j***@m***.health`: first character of the local part and domain, subdomains hidden, top-level domain kept; `undefined` for non-emails
- `getBetterAuthClientWebAuth(client): {webAuth, bearerToken}` — Whether a client from `createBetterAuthClient` is in web bearer mode, and the token it holds; `{webAuth: "cookie", bearerToken: null}` on native, in cookie mode, and for other clients. No request
- `useLoginController({client, rememberedAccounts, onSignedIn, onTwoFactorRequired?, rememberIdentity?, callbackURL?, errorCallbackURL?, error?, onSignUpPress?, onForgotPasswordPress?, providerLabels?, passkeyAutofill?, skipWhenSignedIn?, webAuth?, getBearerToken?, initialEmail?})` — Drives a login screen from a Better Auth client. Returns `{step, methods, isEmailPasswordEnabled, screenProps, twoFactor, signInEmail, signInSocial, signInPasskey, continueAs, forget}`: `step` is `"checking"`, `"login"`, `"twoFactor"` or `"signedIn"`; `isEmailPasswordEnabled` is `false` when the server has email and password off (render `LoginScreen` with `fields={[]}`); `screenProps` spreads into `@terreno/ui` `LoginScreen`; `twoFactor` feeds `TwoFactorChallengeScreen`. A live session calls `onSignedIn` without showing the screen (in bearer mode it first finishes a pending OAuth handoff; with no stored token it asks the server nothing). If `onSignedIn` throws, `step` returns to `"login"` with an error. The passkey button and autofill are web-only. Device sessions (`multiSession.listDeviceSessions`, never in bearer mode) become session cards and hide remembered entries for the same user. Social sign-in uses `signInSocialWithHandoff` in bearer mode and `signIn.social` otherwise. Every finished sign-in is recorded in the store. Server refusals become notices through `getLoginFeedback` ([how-to](../how-to/configure-better-auth.md#5-drop-in-login-screen))
- `TerrenoLoginScreen` — `LoginScreen` connected through `useLoginController`; takes its options plus `fields?` (default `DEFAULT_LOGIN_FIELDS`), `title?`, `logo?`, `trustDeviceDays?`, `initialTrustDevice?` (pass `false` to start "Trust this device" unchecked), `onStepChange?` (called with each new step: `checking`, `login`, `twoFactor`, `signedIn`), `testID?` (default `login-screen`; spinner `${testID}-checking`). Renders the inline two-factor challenge unless `onTwoFactorRequired` is set
- `useAccountSecurity({client, callbackURL, methods?, errorCallbackURL?, linkError?, providerLabels?, passkeySupported?, minPasswordLength?})` — Drives an account security screen from a Better Auth client. Returns `{screenProps, methods, user, refetch}`; `screenProps` (`linkedAccounts`, `password`, `passkeys`, `twoFactor`, `sessions`, `isLoading`, `error`, `onRetry`) spreads into `@terreno/ui` `AccountSecurityScreen`. A card's props are `undefined` when the server's methods (or the client's features) leave it off; passkeys are web-only. Loads `listAccounts`, `passkey.listUserPasskeys`, `getSession({query: {disableCookieCache: true}})` and `listSessions`; each Better Auth `{error}` becomes a thrown `Error` for the card, and after each change only the affected section reloads. Never calls `unlinkAccount` for the only account, or `deletePasskey` for the only sign-in method (`LAST_SIGN_IN_METHOD_MESSAGE`). Links through `linkSocialWithHandoff`; "Set a password" posts `{basePath}/terreno/set-password`. `SESSION_NOT_FRESH` becomes `SIGN_IN_AGAIN_MESSAGE`; a change refused with `CREDENTIAL_ACCOUNT_NOT_FOUND` switches the password card to set mode (`NO_PASSWORD_YET_MESSAGE`). `getLinkErrorMessage(code)` maps a link's `?error=` to safe text ([how-to](../how-to/configure-better-auth.md#6-drop-in-security-screen))
- `TerrenoAccountSecurityScreen` — `AccountSecurityScreen` connected through `useAccountSecurity`; takes its options plus `title?`, `description?`, `header?`, `children?`, `withPage?`, `maxWidth?`, `testID?`
- `recordRememberedSignIn({store, user, method, rememberIdentity?})` — Records a sign-in the controller did not finish, such as one completed on the app's own two-factor screen
- `getLoginFeedback({failure, mode?, originalMethod?}): {notice?, error?, isSignUpClosed}` — Maps `{code?, message?, source: "response" | "url"}` to login screen feedback: `account_not_linked` / `OAUTH_LINK_ERROR` / "account not linked" to guidance for the linking mode, `VERIFY_EMAIL_TO_USE_ACCOUNT` to "verify your email", `signup_disabled` / `EMAIL_PASSWORD_SIGN_UP_DISABLED` to "ask your administrator" (and `isSignUpClosed`), `LINKING_DISABLED`, `provider_not_found`; a response's own message otherwise, and never text from a URL

### JWT auth (legacy)

For backends on `@terreno/api`'s JWT routes (`/auth/login`, `/auth/refresh_token`). Ported
from `@terreno/rtk`'s `generateAuthSlice` and `emptyApi` base query; no Redux.

```tsx
import {jwtAuthAdapter, SessionProvider, useJwtAuth, useSession} from "@terreno/syncdb/auth";
import {createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";

export const jwtAuth = jwtAuthAdapter({baseUrl, headers: appHeaders});
export const apiClient = createApiClient({authProvider: jwtAuth, baseUrl, headers: appHeaders});
export const syncDb = createSyncDb({authProvider: jwtAuth, baseUrl, /* … */});

<SessionProvider source={jwtAuth} syncDbs={[syncDb]} onLogout={() => apiClient.reset()}>
  <App />
</SessionProvider>;

// In a screen:
const {login, signup, googleLogin, resetPassword, logout, isAuthenticating, error} =
  useJwtAuth({adapter: jwtAuth});
await login({email, password});
const {userId, isAuthenticated} = useSession();
```

`jwtAuthAdapter(options)` options:

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | API origin. Required. |
| `storage` | `JwtTokenStorage` | Token storage. Default: `expo-secure-store` on native, AsyncStorage on web (keys `AUTH_TOKEN`, `REFRESH_TOKEN`; nothing is stored during SSR). |
| `paths` | `Partial<JwtAuthPaths>` | Route overrides. Defaults: `login` `/auth/login`, `signup` `/auth/signup`, `refreshToken` `/auth/refresh_token`, `googleLogin` `/auth/google`, `resetPassword` `/resetPassword`. |
| `headers` | object or function | Extra headers on auth requests (e.g. `appHeaders`). |
| `refreshBeforeExpirySecs` | `number` | Refresh when the access token has fewer seconds left. Default `130`. |
| `fetchImpl` | `FetchLike` | Custom `fetch`. |
| `timeoutMs` | `number` | Auth request timeout. Default `30000`. |

The adapter is an `AuthProvider` and a `SessionSource`:

| Member | Behaviour |
|--------|-----------|
| `getToken()` | Stored access token. Under `refreshBeforeExpirySecs` left (or expired), refreshes first. Both tokens expired: signs out and returns `null`. |
| `refresh()` | `POST /auth/refresh_token` with `{refreshToken}`; stores the new pair and resolves `true`. Concurrent calls share one request. `createApiClient` calls it on a 401 and retries once; `createSyncDb` calls it on an auth pause. |
| `getUserId()` / `getSession()` | The stored token's `id` claim; `getSession()` returns `{userId, user: {id}}` or `null`. |
| `onAuthChange(cb)` / `subscribe(listener)` | Fire on login, logout, and token rotation. |
| `login(body)` | `POST /auth/login` with `{email \| username, password}`; stores the tokens and signs in. |
| `signup(body)` | `POST /auth/signup` with `{email, password, ...extra}`; stores the tokens and signs in. |
| `googleLogin({idToken})` | `POST /auth/google`; stores the tokens and signs in. |
| `resetPassword(body)` | `POST /resetPassword` (`{token, password}`); returns `{token, refreshToken, userId}` without signing in. |
| `setTokens({token, refreshToken?})` | Store a pair from a custom route and sign in. |
| `logout()` / `signOut()` | Clear both tokens and notify listeners. JWTs are stateless, so no server call. |

Failed requests reject with `ApiError`. Its `message` is the server's `title`, or the
`message` the JWT routes send on a 401 (for example `"Password or username is incorrect"`).
Status `0` means the request never got a response (`data.code` `network-error` or
`request-timeout`).

When a refresh fails:

- The server rejects it (401, missing tokens in the response, any other HTTP error), or no
  refresh token is stored: both tokens are cleared and the session signs out. syncdb clients
  pause (they never wipe on a sign-out they did not request).
- Network error or timeout: the session and current token stay; the next request retries.

`useJwtAuth({adapter})` must render inside the `SessionProvider` whose `source` is `adapter`.
`login`, `signup`, `googleLogin`, and `resetPassword` set `isAuthenticating` while pending,
store the failure message in `error` (cleared when the next request starts), and reject with
the error. `logout` is the `SessionProvider` logout.

Token helpers (all take an optional `{storage, now}`):

| Function | Returns |
|----------|---------|
| `getTokenExpirationTimes()` | `{authRemainingSecs, refreshRemainingSecs}`; both `undefined` unless both tokens are stored. |
| `shouldShowStillThereModal()` | `true` when the refresh token has 65 seconds or less left. |
| `readJwtTokens(storage?)` | `{token, refreshToken}` from storage. |
| `decodeJwtClaims(token)` | The token's claims (unverified), or `null`. |

## App utilities

`@terreno/syncdb/app` holds app-shell helpers that replace their `@terreno/rtk`
versions. It needs `react`, `react-native`, and `expo-constants`; `useMCPTools` also
needs `@modelcontextprotocol/client`. All are optional peer dependencies.

```typescript
import {
  canOpenAdminPage,
  installDevConsoleLogger,
  useMCPTools,
  useUpgradeCheck,
} from "@terreno/syncdb/app";

installDevConsoleLogger(); // module scope; no-op outside __DEV__

const {isRequired, isWarning, onUpdate} = useUpgradeCheck({recheckOnForeground: true});
const isAdmin = canOpenAdminPage({admin: me?.admin, permissions: me?.permissions});
const {tools} = useMCPTools({authProvider}); // the provider passed to createSyncDb
```

| Export | Description |
|--------|-------------|
| `useUpgradeCheck({pollingIntervalMs, recheckOnForeground, client})` | Calls `GET /version-check` through the request client (`ApiClientProvider` or `client`) with `extra.buildNumber`. Returns `{isRequired, isWarning, requiredMessage, warningMessage, warningCheckCount, canUpdate, onUpdate}`. Skips the check when there is no build number. The server's `pollingIntervalMs` replaces the local fallback after the first response. |
| `hasPermission(permissions, request)` | True when the `/auth/me` `permissions` map grants every requested action |
| `canOpenAdminPage({admin, permissions})` | With RBAC, only `admin:access` opens the admin UI; without it, falls back to `user.admin` |
| `installDevConsoleLogger({baseUrl})` | In `__DEV__`, batches `console.error` / `console.warn` and global errors to `POST /__terreno/browser-logs`. Safe to call more than once. |
| `useMCPTools({authProvider, baseURL})` | Lists the backend's `/mcp` tools with the official MCP client. The token comes from `authProvider.getToken()` on each fetch, so Better Auth and JWT sessions both work. Returns `{tools, isLoading, error, refetch}`. |

`@terreno/syncdb/buildNumber` is node-only (it runs `git`). Import it from
`app.config.ts`, never from app code:

```typescript
import {resolveBuildNumber} from "@terreno/syncdb/buildNumber";

extra: {buildNumber: resolveBuildNumber({configValue: config.extra?.buildNumber})}
```

`resolveBuildNumber` order: `override`, `configValue`, `EXPO_PUBLIC_BUILD_NUMBER` (or
`envVar`), `git rev-list --count HEAD`, then `undefined` (the check is skipped).

## Feature flags

`@terreno/syncdb/flags` reads `@terreno/feature-flags` flags with the request client and
refreshes them when the server emits `featureFlagsChanged` on the sync socket — no second
socket. Requires the optional peers `@openfeature/web-sdk` (and `@openfeature/react-sdk` for
OpenFeature React hooks).

```typescript
import {useFeatureFlags, useTerrenoFeatureFlags} from "@terreno/syncdb/flags";

// Root, above SyncDbProvider: install flags into OpenFeature and listen for pushes.
useTerrenoFeatureFlags({skip: !userId, socket: syncDb, userId});

// Screens: flat accessors over the same cached query.
const {getFlag, getVariant, isLoading} = useFeatureFlags({skip: !userId, socket: null, userId});
```

Options and results: [feature flags reference](./feature-flags.md#terrenosyncdbflags).

## Query windows

Use query windows when a collection is too large to sync whole (messages, events, audit
rows). They match what an RTK list query did — `where`, `sort`, `limit`, `page`, `more`,
`total` — but keep the data local-first and deduplicated.

```typescript
export const syncDb = createSyncDb({
  collections: ["todos", "messages"],
  queryCollections: [{collection: "messages", path: "/messages"}],
  // ...
});
```

**Membership, not copies.** A window is one list query against the collection's
`modelRouter` list endpoint. Its result is an ordered id list stored in the reserved
`_queryWindows` table. Each row lands once in the collection's entity table, keyed by id.
Two windows that overlap share those rows:

- A delta, mutation, or refetch for a shared row writes the store once; every window that
  lists the row re-renders from it.
- Each window lists only its own members. Window B never shows rows that only window A
  fetched.

**Live membership.** When `where` is locally evaluable (see `useQuery`'s `where`), a window
also:

- hides a member whose fields stop matching (an unpinned message leaves the "pinned" window);
- shows cached rows that newly match (a live delta, or a local create) when they sort inside
  the loaded range. With more pages unloaded, a row that sorts after the last loaded row
  waits for `fetchNextPage()`. Without a `sort` and with more pages, only local creates are
  admitted.

A full fetch also records cached rows that matched `where` locally but that the server did
not return (deleted, changed, or no longer visible while this device was offline). They stay
out of the view until a newer delta or a local edit changes them, so stale cached data never
resurrects a row.

Set `liveMatch: false` to show server membership only. Operators only the server runs
(`$search`) also fall back to server membership.

**Fetching.** The first `retain` of a window in a session fetches it; persisted membership
renders meanwhile, so windows work offline. Concurrent fetches of the same window share one
request; a refetch and a `fetchNextPage()` on one window run one after the other. Retained
windows refetch on reconnect and after `forceResync()` — query collections
skip snapshot catch-up, so this is how deltas missed offline are recovered. Windows not on
screen at that moment refetch the next time they are shown. Window fetches
started before a `stop()` or user switch are discarded.

**Seq.** List rows that carry `_syncSeq` (the `syncPlugin` field) are written with that seq.
Rows without it (a `responseHandler` that strips it) are re-read from `GET /sync/entities` so
a later mutation never sends a stale `baseVersion`. Rows with a pending outbox mutation, or
with a newer seq from a delta, are never overwritten. A list `responseHandler` must return the
same shape as the sync serializer; otherwise list rows and delta rows differ.

**Missing `queryFields`.** Every `where` field must be in the route's `queryFields`. The
server answers 400 `query-param-not-allowed` naming the field, the model, and the allowed
list. syncdb turns it into `QueryFieldNotAllowedError` (`field`, `allowedQueryFields`,
`model`), logs it with `console.error`, sets the window's `errorCode` to
`"query-param-not-allowed"`, and rejects `fetchWindow` / `refetch` / `fetchNextPage` with it.
Other list failures throw `ListRequestError` (`status`, `code`, `detail`).

```typescript
import {QueryFieldNotAllowedError} from "@terreno/syncdb";

try {
  await refetch();
} catch (error) {
  if (error instanceof QueryFieldNotAllowedError) {
    // error.field === "title", error.allowedQueryFields === ["completed", "created", "ownerId"]
  }
}
```

**`maxLimit` and pipelining.** `modelRouter` clamps `limit` to the route's `maxLimit` and
echoes the applied value. Window requests always send `page` (so the server never logs a
truncated unpaginated list). When a fetch needs more rows than one request returns — a
`refetch()` after several `fetchNextPage()` calls, or a `pageSize` above `maxLimit` — syncdb
learns the cap from the echoed `limit` and splits the range into sequential page requests
of `maxLimit` rows starting at the aligned page that contains the range, trimming the extra
rows, so offsets stay exact. Each pipelined fetch logs a
`console.warn` naming the row count, the cap, and the request count. Fix it by loading fewer
pages, lowering `pageSize`, or raising `maxLimit` on the route.

**Fully synced collections.** `queryCollections: [{collection: "todos", fullSync: true}]`
keeps normal snapshot sync and also enables windows, for server-side filtering, paging, and
totals over a collection that is already local. See `example-frontend/app/todo-windows.tsx`.

**Limits.**

- `refetch()` with several pages loaded reloads `pageSize × pages` rows (see below).
- Page appends dedupe ids. A delete between page loads can shift offsets and skip one row
  until the next refetch.
- `null` in `where` is rejected (qs would send the string `"null"`); use `{$exists: false}`.
  A top-level `{$in: []}` returns an empty window without a request; an empty array anywhere
  else throws instead of silently widening the query.
- Rows stay in the entity table after their windows unmount. `start()` prunes persisted
  membership of unretained windows not fetched for 7 days (`pruneStale`);
  `pruneUnretained()` drops all unretained membership. Rows are dropped by leave-purge,
  tombstone compaction, or a wipe.

## Codegen

`terreno-syncdb-codegen` is a bin of `@terreno/syncdb`. It reads OpenAPI, discovers list operations with `x-terreno-sync`, and writes typed hooks plus `SYNC_COLLECTIONS`.

```bash
terreno-syncdb-codegen \
  --schema http://localhost:4000/openapi.json \
  --out ./store/syncDbSdk.ts \
  --config ./syncdb-codegen.json
```

Do not edit the generated file. `--collections` filters when extensions exist. When they do not, it reads list/create/patch schemas from `GET /{name}` (or `/{name}/`). A missing path, a list response without `data.items`, a spec with no extensions and no `--collections` all exit non-zero.

A collection name is the route path without its leading slash, so a nested route keeps its
`/`: `modelRouter("/gpt/histories", …)` syncs as `gpt/histories`, and
`useQuery("gpt/histories")` reads it. Names are letters, digits, `_`, and `-` in
`/`-separated segments. Hooks drop the separators and singularize the last segment when the
list item schema has no `$ref` name: `gpt/histories` → `GptHistory`, `useGptHistories`.

### API SDK (`--api-out`)

`--api-out <file>` writes typed request hooks for every operation that is **not** synced
collection CRUD: auth (`/auth/me`), modelRouter actions, AI, consents, announcements,
version check, and plain REST routes. It replaces `@rtk-query/codegen-openapi`. Pass
`--out`, `--api-out`, or both in one run.

```bash
terreno-syncdb-codegen \
  --schema http://localhost:4000/openapi.json \
  --out ./store/syncDbSdk.ts \
  --api-out ./store/apiSdk.ts \
  --config ./syncdb-codegen.json
```

| Generated per operation | Example (`GET /gpt/datasets/{id}?historyId=`) |
|-------------------------|-----------------------------------------------|
| `<Name>Args` | `{id: string; historyId: string}` |
| `<Name>Res` | Response after envelope unwrapping (`{data: X}` → `X`; lists keep `more`) |
| `<name>Request(arg)` | `ApiRequestArgs` for `apiClient.request(...)` |
| `use<Name>Query` / `useLazy<Name>Query` | GET operations; `providesTags` from the operation's OpenAPI tags |
| `use<Name>Mutation` | Other methods; `invalidatesTags` from the operation's OpenAPI tags |

Names follow the RTK codegen rule, so migrated screens keep their hook names: the
camelCased `operationId`, otherwise method + path with `{param}` read as `By<Param>`
(`PATCH /gpt/histories/{id}/rating` → `usePatchGptHistoriesByIdRatingMutation`). Arguments flatten
the same way: one path param, query param, or body is the argument itself; otherwise an
object of path params, query params, and `body`. A `multipart/form-data` body is
`FormData`. Two operations that would share a name exit non-zero; give one an
`operationId`. `excludePaths` in the config file (path prefixes, or regexes starting
with `^`) leaves routes out.

A paginated custom route must return `more` with its `data` (as `GET /announcements/feed`
does: `{data, more, page, total}`). Without `more`, the client unwraps the envelope to the
`data` array and drops `page` and `total`.

```typescript
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

const {data: me} = useGetAuthMeQuery(undefined, {skip: !userId});
const [updateMe] = usePatchAuthMeMutation();
await updateMe({name: "Ada"}).unwrap();
```

## Conflict API

A **conflict** occurs when the client's `baseVersion` (last seen `_syncSeq`) does not match the server's current seq. The server responds with a `conflict` nack (HTTP **409** on `POST /sync/mutate`, or `sync:nack` with `code: "conflict"` on the socket) carrying the canonical server document.

The client records conflicts in the local `_conflicts` table. Read them with:

```typescript
import {listConflicts} from "@terreno/syncdb";

const conflicts = listConflicts({store: client.store});
```

In React, prefer `useConflicts()`.

### Resolution strategies

| Strategy | Behavior |
|----------|----------|
| `"useServer"` | Overwrite local entity with canonical server data/seq; clear pending state; discard conflicted outbox row. Writes a **tombstone** when the server side is deleted. |
| `"keepMine"` | Re-enqueue the mutation under a **fresh** `mutationId` with `baseVersion` set to the server's seq; local optimistic data is kept. All durable mutation metadata, including `mutationMode: "adminWindow"`, is preserved so retried admin-window writes receive the same RBAC, protected-field, hook, and audit handling. |

Resolve via `client.resolveConflict({mutationId, strategy})` or `useConflicts().resolve(...)`.

### Conflict handling modes

- **Default (`haltQueueOnConflict: false`)** — per-entity blocking. Other entities keep draining.
- **`haltQueueOnConflict: true`** — any conflict halts the entire drain until resolved.

`getSyncStatus().blockedEntities` counts entities blocked by conflicts or terminal validation failures.

## Sync status API

`getSyncStatus()` / `useSyncStatus()` return `SyncStatus`:

| Field | Type | Description |
|-------|------|-------------|
| `isOnline` | `boolean` | Transport connected |
| `isSyncing` | `boolean` | Reconcile or replay in flight |
| `queuedCount` | `number` | Outbox rows awaiting send |
| `conflictCount` | `number` | Unresolved conflicts |
| `failedCount` | `number` | Terminal `failed` outbox rows |
| `paused` | `"auth"?` | Replay paused for auth failure |
| `blockedEntities` | `number` | Entities blocked (conflict or validation) |
| `draining` | `boolean` | Outbox drain actively running |
| `sentThisDrain` | `number` | Mutations sent in current/most recent drain |
| `totalThisDrain` | `number` | Queue length when drain began |
| `streams` | `Record<string, number>` | Per-stream cursors (stream → highest applied seq) |
| `collections` | `Record<string, SyncCollectionStatus>` | Per-collection queued/conflict/failed counts |
| `persistence` | `"durable" \| "memory" \| "error"` | Local persistence health (web) |

`SyncCollectionStatus`: `{queuedCount, conflictCount, failedCount}`.

## Stream scoping

Streams are the unit of ordered delivery, keyed `{collection}|{scope}`:

```typescript
sync: {scope: {type: "owner"}}                        // todos|owner:{ownerId}
sync: {scope: {type: "owner", field: "userId"}}       // todos|owner:{userId}
sync: {scope: {type: "tenant", field: "organizationId"}} // todos|tenant:{orgId}
sync: {scope: {type: "broadcast"}}                    // todos|all
sync: {scope: {type: "owner"}, adminBroadcast: true}  // owner stream + todos|admin
sync: {
  scope: (doc) => String(doc.workspaceId),
  snapshotFilter: (user) => ({workspaceId: {$in: [...]}}), // required for custom
}
```

- **Owner** streams use the authenticated socket's user id (client cannot pick another user's stream).
- **Tenant/custom** scopes resolve memberships via `SyncApp` `getUserScopes`.
- **`adminBroadcast`** (default `false`) is an additive fan-in flag on the existing collection `sync` config. When `true`, `sync:delta` emitters also publish to `{collection}|admin`. Do not change the app collection `scope` to broadcast for admin; app clients keep owner/tenant streams. Join `{collection}|admin` with `sync:subscribe {mode: "window"}`. The gate matches the admin UI shell: with `SyncApp({accessControl})`, the caller needs `admin:access`; without RBAC, `user.admin` / `Permissions.IsAdmin` is enough. When `AdminApp` is mounted it also registers that model's list/read permissions and `queryFilter`, so window subscribe, `GET /sync/entities`, and `|admin` live deltas cannot return rows `/admin` REST would hide (product `IsOwner` still treats `user.admin` as owner). Others get `sync:error`. The server confirms `sync:subscribed {mode: "window"}` and does not dump snapshot pages. Clients listed in `createSyncDb({windowCollections})` skip `GET /sync/snapshot` for those collections (startup, subscribe catch-up, and the reconcile timer). Hydrate known ids with `hydrateWindow` (REST rows + `GET /sync/entities`). For that HTTP lookup, an allowed admin-window caller on an `adminBroadcast` collection is not limited to owner/tenant stream membership. Deltas on `{collection}|admin` update or tombstone **ids already in the local window only**; unknown ids are ignored until Refresh or load-more hydrates them (Refresh = current REST query + `hydrateWindow`).
- `AdminApp({organizations: true})` forces `adminBroadcast: false` for models
  with `organizationId`. The current admin-window socket protocol has no
  selected-organization field, so those models use REST with
  `X-Organization-Id` instead of weakening `OrgQueryFilter` or streaming
  cross-organization rows.
- Use a dedicated `createSyncDb` client/store for an admin window when the same app
  also subscribes to that collection through an owner or tenant stream. One socket
  subscription has one mode per collection, and a separate store prevents
  admin-hydrated rows from appearing in the product UI.
- **`snapshotFilter`** restricts `GET /sync/snapshot` server-side. Auto-derived for owner/tenant; required for custom resolver scopes.

## Sync protocol

### Snapshot bootstrap

The client pages every stream it belongs to through `POST /sync/snapshot/batch`, not one
`GET /sync/snapshot` per stream. With 100 collections, a reconnect that finds nothing new
is 2 requests (`GET /sync/streams` plus one batch) instead of 101.

- **Rounds:** each round asks for every stream that still has pages. Streams that reached
  their head drop out, so later rounds give the remaining streams a larger share of the
  5,000-entity budget.
- **Pipelining:** the next round is sent as soon as a response arrives, because its
  cursors come from the response. The client writes the current round while the next
  one downloads.
- **Chunked apply:** each page is written in store transactions of 500 entities, with a
  yield to the event loop between them, so a large page never freezes the UI in one block.
  A stream's cursor advances in the transaction holding its last entity, so a page cut
  short by a crash is fetched again and re-applied as a no-op.
- **Older servers:** a 404 without an APIError body (the route does not exist) switches
  the client to per-stream `GET /sync/snapshot` paging, `snapshotConcurrency` streams at
  a time, for the rest of the session. An APIError 404, such as an unknown collection,
  fails that pass and keeps batching on.
- **One pass per stream:** a batch pass owns each of its streams the way a per-stream
  pass does, so a purge (`forceResync`, wipe) waits for it, and a pass that is superseded
  by a sign-out or user switch stops between chunks without writing the rest.

### HTTP routes (`SyncApp`, all authenticated)

| Endpoint | Purpose |
|----------|---------|
| `GET /sync/snapshot?collection=&stream=&cursor=&limit=` | Bootstrap + catch-up for one stream (`limit` max 100). Soft-deleted documents, including pre-sync rows paged by `legacyCursor` (seq 0), arrive as tombstones with `data: null` |
| `POST /sync/snapshot/batch` | Bootstrap + catch-up for many streams in one round trip. Body `{streams: [{stream, cursor?, legacyCursor?}], limit?}`, at most 500 streams, no repeats. `limit` (default 5,000, max 10,000) is the entity budget for the whole response, split evenly across the streams. Returns `{pages}`, one `GET /sync/snapshot`-shaped page per stream in request order. Any stream the caller may not read fails the whole request |
| `GET /sync/streams` | Current stream membership for the user |
| `GET /sync/entities` | Point lookup for entity repair and admin window hydrate. Admin-window callers (`admin:access` with RBAC, else `user.admin`) on `adminBroadcast` collections receive requested ids across product streams. When AdminApp registered a scope, list/read/`queryFilter` still apply; unknown or out-of-scope ids are omitted |
| `POST /sync/mutate` | Single mutation (HTTP fallback). Optional `mutationMode: "adminWindow"` validates `adminBroadcast`, admin-window access, and a registered AdminApp write scope, then runs the shared sync executor with **AdminApp** pre/post hooks (not product `modelRouter` hooks), plus the same permission (including org membership), stripping, and audit semantics as `/admin` REST. HTTP mutate binds `X-Organization-Id` into org context |
| `POST /sync/mutate/batch` | Batched mutations (max 100, strict order, stop at first non-ack). Each mutation may carry `mutationMode: "adminWindow"` under the same AdminApp executor hook path as single mutate |
| `GET /sync/key` | Per-user encryption key material (web) |

Conflict responses on mutate: **409** with `{nack}` body (`code: "conflict"`).

### Socket events (`RealtimeApp`)

| Event | Direction | Payload |
|-------|-----------|---------|
| `sync:subscribe` / `sync:unsubscribe` | client → server | `{collections: string[], mode?: "window"}` |
| `sync:subscribed` | server → client | `{collection, streams, mode?: "window"}` — sent after the stream rooms are joined; full-mode clients page each confirmed stream from its cursor. `mode: "window"` joins `{collection}\|admin` only and must not trigger snapshot paging |
| `sync:error` | server → client | `{collection, message}` |
| `sync:delta` | server → client | `{collection, id, method, data?, seq, stream, deleted?, frontierSeq?}` |
| `sync:mutate` | client → server | `{mutationId, collection, operation, id?, data?, baseVersion?, mutationMode?}` — validated `mutationMode: "adminWindow"` uses AdminApp executor hooks server-side |
| `sync:ack` | server → client | `{mutationId, id, seq}` |
| `sync:nack` | server → client | `{mutationId, code, serverDoc?, serverSeq?, serverDeleted?, message?, retryAfterMs?}` |
| `sync:mutateBatch` | client → server | `{mutations: SyncMutateRequest[], batchId?}` |
| `sync:auth-expired` | server → client | `{reason: "expired" \| "disabled"}` — session re-validation sweep; client enters auth-pause |
| any other name | server → client | App events (for example `featureFlagsChanged` `{key}`), delivered to `onSocketEvent` / `useSocketEvent` listeners |

Limits: 50 collection subscriptions per socket; 100 mutations/second per socket (each batch mutation counts); batches capped at 100.

A redelivered `mutationId` returns the outcome recorded for it only to the same user and only
for the collection it was first sent to; any other replay gets an `unauthorized` nack. A
replayed `conflict` nack includes `serverDoc` only when the caller can still read the document
now (read permission and stream membership, or the admin broadcast scope for an admin-window
mutation); otherwise it carries `serverSeq` alone.

## Encryption at rest

**Web:** AES-256-GCM encrypted IndexedDB by default via pluggable `KeyProvider`:

- **`createServerKeyProvider`** (default) — derives key from `GET /sync/key` material (HKDF); server can rotate/revoke.
- **`createLocalKeyProvider`** — device-local random key; no server copy.

```typescript
import {createLocalKeyProvider, createSyncDb} from "@terreno/syncdb";

const syncDb = createSyncDb({
  name: "myapp",
  collections,
  authProvider,
  baseUrl,
  keyProvider: createLocalKeyProvider(),
});
```

`start()` resolves the key before it loads the store, while the session is still valid.
The derived key is cached in IndexedDB, so the flush in `stop()` never fetches
`/sync/key`. Logging out while `start()` is still running keeps pending outbox writes.
If the key fetch fails (an offline cold start), `start()` still resolves and the next
save retries the fetch.

Saves are debounced (500 ms). The store is serialized once per write, not once per
transaction: autosave compares TinyBase's content hashes (O(1)) to skip saves the last
write already covered, so a bootstrap of many pages costs a few writes instead of one
full-store serialization per page.

Undecryptable persisted data triggers wipe + re-bootstrap by default (`onDecryptFailure` to override). Storage read errors surface `persistence: "error"` without overwriting the blob.

**Native:** plaintext SQLite in the OS sandbox (by design).

## Testing

```typescript
import {createFakeTransport} from "@terreno/syncdb/testing";
import {createSyncDb} from "@terreno/syncdb";

const transport = createFakeTransport();
const client = createSyncDb({
  name: "test",
  collections: ["todos"],
  authProvider: fakeAuth,
  transport,
  httpChannel: fakeHttp,
});

transport.respondWithAck();
transport.deliverDelta({...});
```

`createFakeTransport` records sent mutations, simulates connectivity, delivers deltas, and queues ack/nack responders. `transport.emitEvent(name, ...args)` delivers an app event to `onSocketEvent` listeners; `eventListenerCount(name)` reports how many are bound.

## Environment variables

`@terreno/syncdb/config` reads these at import; the core client reads none. Host apps typically set:

| Variable | Used by | Description |
|----------|---------|-------------|
| `EXPO_PUBLIC_API_URL` | `@terreno/syncdb/config` `baseUrl` | Backend origin passed to `createSyncDb({baseUrl})` and `createApiClient({baseUrl})` |
| `EXPO_PUBLIC_DEV_API_PORT` | `@terreno/syncdb/config` | Local dev API port (default `4000`) |

Backend sync requires a MongoDB replica set (`MONGO_URI` with `replicaSet=`) for `RealtimeApp` change streams.

## Conventions

- **Local-first only** — there is no server-first mode. The local store is always the read source.
- **Synced models need `String` `_id`** — offline creates mint client ids (UUIDs); default ObjectId `_id` cast-fails.
- **Soft delete only** on synced models — `isDeletedPlugin` required; hard deletes break tombstone catch-up.
- **No `bulkWrite` / `updateMany` / `deleteMany`** on synced models — use per-document loops.
- **Do not write reserved tables** (`_outbox`, `_cursors`, `_conflicts`) directly — use `client.mutate`, hooks, and `resolveConflict`.
- **User switch wipes local data** — confirmed different-user login clears the previous user's store; bare logout/401 does not (INV-2).
- **Non-synced routes use the request client** — `/auth/me`, modelRouter actions, AI,
  and other request/response routes go through generated `store/apiSdk.ts` hooks
  (`terreno-syncdb-codegen --api-out`) or `useApiQuery` / `useApiMutation`. Eligible
  admin String-`_id` collection CRUD uses windowed syncdb; other admin requests use
  admin-frontend's host-bound fetch client. See
  [How to upgrade from @terreno/rtk to @terreno/syncdb](../how-to/migrate-rtk-to-syncdb.md).
