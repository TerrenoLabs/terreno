# @terreno/syncdb

Local-first data layer for Terreno frontends. A TinyBase `MergeableStore` on device is the UI source of truth: reads come from the local store, writes apply optimistically into a durable outbox, and the server reconciles asynchronously over a socket delta protocol with HTTP snapshot catch-up. Supersedes `@terreno/rtk` for data-synchronization concerns.

## Table of Contents

- [Installation](#installation)
- [Architecture](#architecture)
- [Backend setup](#backend-setup)
- [createSyncDb configuration](#createsyncdb-configuration)
- [SyncDb client methods](#syncdb-client-methods)
- [React hooks](#react-hooks)
- [Query windows](#query-windows)
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
- React (`@terreno/syncdb/react`): `SyncDbProvider`, `useEntity`, `useQuery`, `useEntityIds`, `useWindowQuery`, `useMutate`, `useSyncStatus`, `useConflicts`, `useSyncDebugLog`, `createCollectionHooks`
- CLI: `terreno-syncdb-codegen` (generates `SYNC_COLLECTIONS` + friendly hooks from OpenAPI)
- Testing (`@terreno/syncdb/testing`): `createFakeTransport`

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
       │   GET /sync/snapshot (bootstrap + catch-up, HTTP)
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
- **`RealtimeApp`** — Socket.io server with change-stream-driven `sync:delta` emission. Requires a **MongoDB replica set** (change streams). `modelRouter` `realtime` (RTK `sync` events) is deprecated and removed in Terreno 58; do not add it to new models.
- **`ensureSyncIndexes`** — `TerrenoApp.start()` binds the HTTP port first (or attaches to `httpServer` if the process already listened), then awaits index builds for snapshot queries and sync bookkeeping (`SyncMutation.mutationId` unique, `SyncCounter.stream` unique, etc.). Registration queues this work without contacting MongoDB, so models can load before the database connects. Hosts that build Express without `TerrenoApp.start()` should await `ensureSyncIndexes()` after connecting.

Socket auth requires at least one configured authentication method. It enables legacy JWT
validation when `tokenSecret` or `TOKEN_SECRET` is available. Better Auth can be used without
a JWT secret:

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
| `onDecryptFailure` | `() => void` | wipe + re-bootstrap (with `console.warn`) | Override web decrypt-failure recovery |
| `tombstoneRetentionMs` | `number` | `7776000000` (90 days); `0` disables | Client tombstone compaction after successful reconcile |
| `startAuthRetryAttempts` | `number` | `3`; `1` disables | `start()` attempts to resolve `getUserId()` |
| `startAuthRetryDelayMs` | `number` | `250` | Delay between those attempts |

`start()` needs an authenticated user. It retries `getUserId()` briefly (transient session races after login) before rejecting.

## SyncDb client methods

| Method | Description |
|--------|-------------|
| `start()` | Resolve user, run wipe-on-user-change check, start persistence, connect transport, subscribe collections, start reconcile timer. Resolves even when offline. Idempotent while already started. |
| `stop()` | Disconnect, stop persistence, clear timers and listeners. |
| `goOffline()` | Simulated outage: disconnect transport, pause replay/reconcile/timer; local mutations keep queueing. |
| `goOnline()` | End simulated outage; reconnect triggers reconcile + outbox replay. |
| `mutate({collection, operation, id?, data?})` | Optimistic local write + durable outbox enqueue + fire-and-forget replay. Returns `{mutationId, id}`. |
| `reconcile()` | HTTP snapshot catch-up for every known stream; runs tombstone compaction on success. Also runs automatically on (re)connect, on a rate-limited seq-jump hint, and on the periodic timer; each `sync:subscribed` confirmation additionally pages just the streams it names. |
| `hydrateWindow({collection, ids, restRows?})` | Admin window upsert: REST rows (optional) land immediately; every requested id is also fetched from `GET /sync/entities` before this resolves so seq/deleted metadata is canonical for immediate update/delete. A `{collection}|admin` delta that lands while the fetch is in flight wins, so hydration never rewinds a row to an older seq. Unknown ids are ignored. |
| `queryWindows` | Server query windows for `queryCollections`: `fetchWindow({query, nextPage?})`, `getWindow(query)`, `retain(query)` → release, `refetchRetained()`, `pruneUnretained()`, `subscribe(cb)`, `keyFor(query)`. See [Query windows](#query-windows). |
| `forceResync()` | Purge every known stream locally and re-bootstrap from cursor 0 (outbox/conflicts untouched). Returns `{ok, reason?, streams, purged, repaired}`. After discovery and each stream bootstrap it waits for in-flight `start`/`stop`/auth-change work, then abandons with `reason: "superseded"` when that work switched users or generations. |
| `replayOutbox()` | Drain queued mutations for the current user now. |
| `resolveConflict({mutationId, strategy})` | Apply `"useServer"` or `"keepMine"` to a recorded conflict. |
| `retryFailed({entityId})` | Re-enable an entity's queued successors after a terminal validation failure. |
| `signOut()` | Explicit teardown like `stop()`; wipes local data only when `wipeOnSignOut: true`. |
| `getSyncStatus()` | Snapshot of aggregate sync state (see [Sync status API](#sync-status-api)). |
| `onStatusChange(callback)` | Subscribe to connectivity/syncing changes; returns unsubscribe. |
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

### `createCollectionHooks`

Factory used by `terreno-syncdb-codegen` and by hand-written custom collections. Returns six operation hooks (`useListQuery`, `useWindowQuery`, `useReadQuery`, `useCreateMutation`, `useUpdateMutation`, `useDeleteMutation`). Generated SDKs rename them to friendly names (`useTodos`, `useTodosWindow`, `useTodo`, `useCreateTodo`, …). `useWindowQuery` works only for collections listed in `queryCollections`. Mutation hooks return `[trigger]`; triggers apply locally and return `{mutationId, id}` synchronously. Optional `retries` maps to `maxAttempts` (`false` → 1, a number → that many, omitted → engine default).

```typescript
export const {useListQuery: useNotes, useCreateMutation: useCreateNote} =
  createCollectionHooks<Note, CreateNoteBody, UpdateNoteBody>({
    collection: "notes",
  });
```

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

### HTTP routes (`SyncApp`, all authenticated)

| Endpoint | Purpose |
|----------|---------|
| `GET /sync/snapshot?collection=&stream=&cursor=&limit=` | Bootstrap + catch-up per stream |
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

Limits: 50 collection subscriptions per socket; 100 mutations/second per socket (each batch mutation counts); batches capped at 100.

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

`createFakeTransport` records sent mutations, simulates connectivity, delivers deltas, and queues ack/nack responders.

## Environment variables

Syncdb reads no environment variables directly. Host apps typically set:

| Variable | Used by | Description |
|----------|---------|-------------|
| `EXPO_PUBLIC_API_URL` | `@terreno/rtk` `baseUrl` | Backend origin passed to `createSyncDb({baseUrl})` |

Backend sync requires a MongoDB replica set (`MONGO_URI` with `replicaSet=`) for `RealtimeApp` change streams.

## Conventions

- **Local-first only** — there is no server-first mode. The local store is always the read source.
- **Synced models need `String` `_id`** — offline creates mint client ids (UUIDs); default ObjectId `_id` cast-fails.
- **Soft delete only** on synced models — `isDeletedPlugin` required; hard deletes break tombstone catch-up.
- **No `bulkWrite` / `updateMany` / `deleteMany`** on synced models — use per-document loops.
- **Do not write reserved tables** (`_outbox`, `_cursors`, `_conflicts`) directly — use `client.mutate`, hooks, and `resolveConflict`.
- **User switch wipes local data** — confirmed different-user login clears the previous user's store; bare logout/401 does not (INV-2).
- **Keep `@terreno/rtk` for non-synced routes** — generated OpenAPI hooks remain
  the right tool for custom REST endpoints, auth, feature flags, and ObjectId
  admin compatibility CRUD. Eligible admin String-`_id` collection CRUD uses
  windowed syncdb; framework admin RPC uses its host-bound fetch client. See
  [How to migrate from RTK to syncdb](../how-to/migrate-rtk-to-syncdb.md).
