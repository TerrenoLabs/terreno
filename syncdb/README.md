# @terreno/syncdb

Local-first data layer for @terreno apps: TinyBase MergeableStore, durable outbox, websocket delta sync, encrypted web persistence.

Local-first data layer for Terreno apps. A TinyBase `MergeableStore` (encrypted IndexedDB on web, expo-sqlite on native) is the UI's source of truth: reads come from the local store, writes apply optimistically and enqueue in a durable outbox, and the server reconciles asynchronously over a socket delta protocol with HTTP snapshot catch-up. Every mutation executes the existing `@terreno/api` modelRouter write path — identical permissions, hooks, and validation as REST. Supersedes `@terreno/rtk` for data-synchronization concerns (see [the migration guide](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/migrate-rtk-to-syncdb.md)).

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

## Install

```bash
bun install @terreno/syncdb
# native persistence (optional peer) — use `expo install` so the version matches your SDK:
bunx expo install expo-sqlite
```

Install `expo-sqlite` in the **app**, not only in a library that depends on `@terreno/syncdb`: Expo autolinking walks the app's own dependencies, so a nested copy leaves the ExpoSQLite native module out of the build and native persistence fails to start. Rebuild the native project after adding it — reloading JS is not enough.

React bindings live on the `@terreno/syncdb/react` subpath so the main entry stays importable without react.

## Codegen

`terreno-syncdb-codegen` lives in this package (not a separate npm package). It reads a backend OpenAPI spec and writes typed collection hooks.

```bash
terreno-syncdb-codegen \
  --schema http://localhost:4000/openapi.json \
  --out ./store/syncDbSdk.ts \
  --config ./syncdb-codegen.json
```

| Flag | Required | Meaning |
|------|----------|---------|
| `--schema` | yes | OpenAPI URL or JSON file |
| `--out` | yes | Output `.ts` path |
| `--collections a,b` | no | Allowlist when `x-terreno-sync` exists; otherwise reads GET `/name` (or `/name/`) list schemas. Missing path or missing `data.items` is an error. |
| `--config` | no | JSON `{overrides: {todos: {retries: false}}}` |
| `--no-format` | no | Skip biome formatting |

List operations for `modelRouter` collections with `sync: {...}` include `"x-terreno-sync": {collection, scope}` so the CLI can discover them. Generated files call `createCollectionHooks` from `@terreno/syncdb/react` and rename the factory keys to friendly names (`useTodos`, `useTodo`, `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo` for collection `todos`). Do not edit the output; add custom collections in a sibling file with the same factory.

`bun run build:binary` compiles a standalone `dist/terreno-syncdb-codegen` binary.

## Quick start

### Backend

Apply both required plugins to the schema, add a `sync` config to the modelRouter (three-argument form required), and register `SyncApp` (HTTP routes) plus `RealtimeApp` (socket + `sync:delta` emission):

```typescript
import {
  isDeletedPlugin,
  modelRouter,
  OwnerQueryFilter,
  Permissions,
  RealtimeApp,
  SyncApp,
  syncPlugin,
  TerrenoApp,
} from "@terreno/api";

todoSchema.plugin(isDeletedPlugin); // soft delete — required (deletes must remain queryable tombstones)
todoSchema.plugin(syncPlugin); // stamps a per-stream _syncSeq on every write

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
  },
});

new TerrenoApp({userModel: User})
  .register(todoRouter)
  .register(new SyncApp()) // GET /sync/snapshot, POST /sync/mutate, GET /sync/key
  .register(new RealtimeApp()) // Socket.io server; installs sync:subscribe/sync:mutate handlers
  .start();
```

Registration is validated at startup: a model with a `sync` config but no `isDeletedPlugin`, no `syncPlugin`, a missing scope field, or a custom scope without a `snapshotFilter` throws with an actionable message. The registry also creates the `{scopeField, _syncSeq}` compound index that snapshot/catch-up queries use.

Index requirement: `TerrenoApp.start()` awaits `ensureSyncIndexes()` before listening, which builds both the per-model snapshot indexes and the bookkeeping indexes registering `SyncApp` enqueues (`SyncCounter.stream` and `SyncMutation.mutationId` uniques, the `SyncScopeMove` lookups, `SyncKey.userId`). These are correctness requirements, not just performance: the unique `mutationId` index is what makes duplicate mutation deliveries idempotent, and the unique `stream` index is what keeps the counter upsert race from minting duplicate seqs — so they must not depend on Mongoose `autoIndex`, which is commonly disabled in production. An index-build failure fails startup loudly; hosts that build the Express app without `TerrenoApp.start()` should await `ensureSyncIndexes()` themselves.

`RealtimeApp` requires a MongoDB replica set (change streams). Socket auth accepts legacy JWTs by default; add Better Auth sessions with `new RealtimeApp({betterAuth: {auth, userModel: User}})`.

### Frontend

```typescript
import {betterAuthAdapter, createSyncDb} from "@terreno/syncdb";
import {SyncDbProvider, useMutate, useQuery, useSyncStatus} from "@terreno/syncdb/react";
import {createBetterAuthClient} from "@terreno/rtk";

const authClient = createBetterAuthClient({baseURL: "http://localhost:4000"});

export const syncDb = createSyncDb({
  authProvider: betterAuthAdapter(authClient),
  baseUrl: "http://localhost:4000",
  collections: ["todos"],
  name: "myapp",
});

// After login. Resolves even when offline — the app works local-first and
// syncs when connectivity returns.
await syncDb.start();
```

```tsx
const App = () => (
  <SyncDbProvider client={syncDb}>
    <TodoList />
  </SyncDbProvider>
);

const TodoList: React.FC = () => {
  const todos = useQuery<Todo>("todos", {filter: (t) => !t.completed});
  const {create, update, remove} = useMutate("todos");
  const status = useSyncStatus(); // {isOnline, isSyncing, queuedCount, conflictCount, streams}

  // create({data: {title: "Milk"}}) applies locally, enqueues in the durable
  // outbox, and replays to the server (socket first, HTTP fallback).
  // update({id, data: {completed: true}}) merges fields; remove({id}) soft-deletes.
  ...
};
```

### Client API surface

```typescript
const client = createSyncDb({
  name,                           // persisted database name
  collections,                    // string[] — synced collections
  authProvider,                   // {getToken, getUserId, onAuthChange}
  baseUrl?,                       // server origin (required unless transport + httpChannel injected)
  keyProvider?,                   // web encryption key provider (default: server-derived via GET /sync/key)
  persisterFactory?,              // platform persister override
  transport?, httpChannel?,       // test/DI overrides
  reconcileIntervalMs?,           // periodic reconcile (default 5 min; 0 disables)
  seqJumpReconcileMinIntervalMs?, // seq-jump reconcile rate limit (default 30s)
  batchSize?,                     // max mutations per batched drain send (default 50; server caps at 100)
  haltQueueOnConflict?,           // conflict policy — see "Conflict handling modes" below (default false)
  snapshotConcurrency?,           // streams snapshot-paged at once (default 6; 1 = one at a time)
  onDecryptFailure?,              // override the default wipe+re-bootstrap on undecryptable data (web)
  tombstoneRetentionMs?,          // client-side tombstone compaction window (default 90 days; 0 disables)
  onAuthRequired?,                // fires once per auth-pause episode — prompt for re-login
  wipeOnSignOut?,                 // signOut() also wipes local data (default false; see "Sign-out" below)
  startAuthRetryAttempts?,        // start() attempts at resolving a user (default 3; 1 disables retrying)
  startAuthRetryDelayMs?,         // delay between those attempts (default 250ms)
  debug?,                         // in-memory debug event log — see "Debug log" below (default off)
});

client.start() / client.stop();  // start() is idempotent while already started (a second call is a no-op)
client.mutate({collection, operation, id?, data?}); // → {mutationId, id}
client.reconcile();       // HTTP snapshot catch-up for every collection; also runs tombstone compaction on success
client.forceResync();     // purge every known stream locally and re-bootstrap — see "Forcing a full resync"
client.replayOutbox();    // drain queued mutations now
client.resolveConflict({mutationId, strategy: "useServer" | "keepMine"});
client.retryFailed({entityId});  // re-enable an entity's queued successors after a terminal validation failure
client.goOffline() / client.goOnline();  // simulated outage — see "Simulated offline" below
client.signOut();         // explicit sign-out teardown (wipes only with wipeOnSignOut)
client.getSyncStatus();   // {isOnline, isSyncing, queuedCount, conflictCount, failedCount, blockedEntities,
                           //  paused?, draining, sentThisDrain, totalThisDrain, streams, persistence}
                           //  persistence: "durable" | "memory" | "error" — see "Encryption at rest" below
client.onStatusChange(cb);
client.store / client.outbox; // low-level access
client.debug;             // the debug log when `debug` is enabled, else undefined
```

`start()` needs an authenticated user, and it is normally called right after a login completes — so a `null` from `authProvider.getUserId()` is usually a transient session-fetch race rather than a real logged-out state. It therefore retries up to `startAuthRetryAttempts` times (default 3, `startAuthRetryDelayMs` apart) before rejecting with "requires an authenticated user". Set `startAuthRetryAttempts: 1` to fail fast.

React hooks (`@terreno/syncdb/react`): `SyncDbProvider`, `useSyncDbClient`, `useEntity(collection, id)`, `useQuery(collection, {filter?, sort?, includeDeleted?})`, `useEntityIds(collection, options?)`, `useMutate(collection)`, `useSyncStatus()`, `useConflicts()`, `useSyncDebugLog()`.

**Prefer `useEntityIds` for large lists.** It takes the same options as `useQuery` but returns only the ordered ids, with an array whose identity changes only when the id membership or order changes. Paired with a per-row `useEntity`, a field update re-renders that one row instead of the whole list:

```tsx
const ids = useEntityIds<Todo>("todos", {filter: (t) => !t.completed, sort: byCreatedDesc});
return <>{ids.map((id) => <TodoRow id={id} key={id} />)}</>; // TodoRow calls useEntity("todos", id)
```

### Public API surface

The package has three entry points, and only what they export is API:

- `@terreno/syncdb` — the client (`createSyncDb`), protocol/status/conflict types, the Better Auth adapter, key providers and codecs, persister factories, the transport/HTTP-channel constructors (for DI), `wipeLocalData`, `generateMutationId`, `listConflicts`, and `OUTBOX_TABLE` for inspecting queued mutations via `client.store.raw.getTable(...)`.
- `@terreno/syncdb/react` — the hooks above plus `SyncDbProvider` (a separate subpath because `react` is an optional peer dependency).
- `@terreno/syncdb/testing` — test doubles (`createFakeTransport`), kept out of production bundles.

Everything else under `src/` is internal and can change in a patch release. In particular the cursor mutators, outbox/conflict writers, raw row shapes, the IndexedDB helpers, and the debug broadcast bridge are deliberately unexported: writing to a reserved table behind the client's back breaks the invariants replay and reconcile depend on.

## Client operations

### Simulated offline

`goOffline()` disconnects the transport and pauses replay, reconcile, and the periodic timer while keeping the resolved user and persistence alive — mutations keep applying locally and queueing durably, and `getSyncStatus().isOnline` reports `false`. `goOnline()` reconnects, resubscribes, and restarts the timer; the reconnect status event then triggers a reconcile and drains the outbox. This is how the example app's dev panel and the e2e suites exercise offline behavior without touching the real network.

### Sign-out

`signOut()` is the explicit, host-app-initiated teardown: it does everything `stop()` does (disconnect, clear listeners and timers, flush and destroy the persister) and also clears the in-memory current-user pointer. It wipes local data **only** when `createSyncDb` was given `wipeOnSignOut: true`. That is deliberate (INV-2): a bare logout or a 401 never wipes, because unsynced local mutations belong to the user who may sign back in moments later. Local data is otherwise only wiped on a confirmed *different*-user login. Call `start()` again to sync as the next signed-in user.

### Forcing a full resync

`forceResync()` purges every known stream locally and re-bootstraps from cursor 0, without touching the outbox or recorded conflicts. Use it when a device is suspected to have diverged (a support "resync my data" button) rather than as routine catch-up — `reconcile()` is the incremental path. It re-discovers stream membership first, since a stale local set is itself one of the ways a device diverges. The result reports what happened instead of failing silently:

```typescript
const {ok, reason, streams, purged, repaired} = await client.forceResync();
```

| `reason` (only when `ok: false`) | Meaning |
|---|---|
| `noHttpChannel` | No HTTP channel is configured (no `baseUrl` and none injected). |
| `offline` | The client is in a simulated outage (`goOffline()`). |
| `authPaused` | Replay/reconcile are auth-paused, or the resync itself hit a 401. Sign in again. |
| `noStreams` | The server reported no streams for this user and there was no local set to fall back on. Stable — retrying reproduces it. |
| `superseded` | A `stop()`/`start()` cycle or a different-user login took over mid-resync, so the pass abandoned its work rather than writing into a store that now belongs to another lifecycle or user. Retry once things settle. |

`purged`/`repaired` are still meaningful on a `superseded` result: they report the work done before the abort.

### Debug log

`createSyncDb({debug: true})` (or `{debug: {capacity}}`) enables an in-memory ring buffer of sync events — local mutations, acks/nacks, inbound deltas, conflicts, reconcile/replay passes, connectivity changes. It is off by default with zero overhead; when on, `client.debug.snapshot()` returns a plain serializable object (the shape a future MCP introspection tool returns), and `useSyncDebugLog()` exposes `{events, stats, log, clear}` for a live debugger UI (see `example-frontend/app/syncdb-debug.tsx`). On the web the log is mirrored across windows/tabs over a `BroadcastChannel`, so a debugger opened in a second window sees the app window's local mutations; the bridge is closed by `stop()`/`signOut()` and re-opened by `start()`.

## Batched replay & stop-the-line policy

Queued mutations drain in contiguous chunks (≤ `batchSize`, default 50) over `POST /sync/mutate/batch` (or `sync:mutateBatch` when the socket is connected) rather than one request per mutation — an offline session of hundreds of edits costs `~N/batchSize` round-trips instead of `N`. Ordering is never sacrificed for this: a chunk carries at most one mutation per entity (a second mutation for an entity already in the chunk cuts it short — the next chunk picks it up once the first has acked and the send-time `baseVersion` refresh has run), and the server applies a batch strictly in array order, stopping at the first non-ack (results shorter than the request means the client re-sends the untouched tail — safe by idempotency). If the server or transport doesn't support batching (HTTP 404, or a socket that never acknowledges `sync:mutateBatch`), the client falls back to single-mutation sends in the same global order and re-probes batch support on the next reconnect.

Not every failure is handled the same way — the table below is the client's stop-the-line policy:

| Outcome | Policy |
|---|---|
| `error` (transient), transport failure/timeout, `unauthorized` | **Halts the whole drain.** Jittered backoff (or auth-pause) applies; nothing after it sends until the retry/re-auth. |
| `rate_limited` | Treated **exactly like a transport failure**: back to `queued` with the same unlimited jittered backoff (the server's `retryAfterMs`, when present, is a floor on that backoff), never counted against the error-nack budget (`errorNackCount`). A rate limit is the server asking the client to slow down — it must never look like a durable-data error or push the client toward terminal `failed`. Halts the whole drain, same as a transport failure. |
| `conflict` | **Blocks only that entity** by default: the entity's later queued mutations are skipped (stay `queued`, budgets untouched) until the user resolves the conflict via `resolveConflict`; other entities keep draining. Set `haltQueueOnConflict: true` to escalate a conflict into a whole-drain halt instead (for apps with cross-entity ordering dependencies where an unresolved conflict must not let anything past it). |
| `validation` | Terminal for that mutation (existing `markFailed` behavior) and its entity's queued successors are skipped-and-surfaced the same way a conflict blocks — a successor built on a rejected write is likely also invalid. Re-enable them with `client.retryFailed({entityId})` once the underlying issue is fixed. A block with no queued successor left (e.g. its failed row aged out via `prune()`) is garbage-collected automatically — a brand-new mutation for that entity is never quarantined forever. |

### Conflict handling modes

- **Default (`haltQueueOnConflict: false`)** — per-entity blocking. A conflict on one entity never stalls unrelated entities; only that entity's own queue is paused pending `resolveConflict`. Best for apps where entities are largely independent (e.g. a todo list).
- **`haltQueueOnConflict: true`** — whole-drain halt. Any conflict stops the ENTIRE drain until it's resolved, even for unrelated entities. Choose this when later-queued mutations (in any entity/collection, or across collections via foreign-key-style references) may depend on assumptions invalidated by the conflicting write, and blindly continuing risks compounding the problem. This is the stronger guarantee when your data model has cross-collection references (e.g. a todo referencing a project id) and you want ordering correctness to trump availability of unrelated entities during a conflict.

`client.getSyncStatus().blockedEntities` reports how many distinct entities are currently blocked (conflict or skipped validation failure) so the UI can surface it (see `SyncStatusBanner`'s failed/conflict badges).

### Cross-collection reference blocking (per-entity mode)

Under the default per-entity blocking mode, a conflict or validation failure on one entity does not, by itself, stop mutations for *unrelated* entities. But apps commonly have cross-collection references — e.g. creating a project P and then a todo T with `{projectId: P}` — where T is meaningless if P never lands on the server. To keep that case safe without requiring `haltQueueOnConflict: true` for the whole app, the coordinator also blocks a queued mutation whose parsed `args` contain, anywhere (recursively through nested objects/arrays), a string that exactly equals the entity id of a currently-blocked entity belonging to the same user. So if P conflicts, T (referencing P's id) stays `queued` and is never sent until P's conflict is resolved — even though T's own entity has no conflict of its own. This blocking is recomputed fresh on every drain pass from current block state (never a persisted dependency graph), so resolving P via `resolveConflict`/`retryFailed` naturally unblocks T on the next drain. It is intentionally conservative — a false-positive block (a string that happens to match a blocked id but isn't really a reference) is safe; a false negative is not.

If your data model has enough cross-collection references that you want ordering guaranteed for ALL entities (not just ones whose args happen to reference a blocked id), use `haltQueueOnConflict: true` instead — see "Conflict handling modes" above.

## Stream scoping

Streams are the unit of ordered delivery and cursor resumption, keyed `{collection}|{scope}` — multi-tenant by default:

```typescript
sync: {scope: {type: "owner"}}                       // todos|owner:{ownerId}   (field defaults to "ownerId")
sync: {scope: {type: "owner", field: "userId"}}      // todos|owner:{userId}
sync: {scope: {type: "tenant", field: "organizationId"}} // todos|tenant:{orgId}
sync: {scope: {type: "broadcast"}}                   // todos|all
sync: {
  scope: (doc) => String(doc.workspaceId),           // todos|custom:{value}
  snapshotFilter: (user) => ({workspaceId: {$in: [...]}}), // REQUIRED for custom scopes
}
```

- **Owner** streams are always keyed by the authenticated socket's own user id — a client-supplied id never selects the stream.
- **Tenant** (and custom) subscriptions resolve the user's memberships via `SyncAppOptions.getUserScopes`:

```typescript
new SyncApp({
  getUserScopes: async (user, entry) => {
    const memberships = await Membership.find({userId: user.id});
    return memberships.map((m) => String(m.organizationId));
  },
});
```

- **`snapshotFilter`** is the server-side query restricting `GET /sync/snapshot` to the caller's documents. It is derived automatically for owner (`{field: user.id}`) and tenant (`{field: {$in: getUserScopes(...)}}`) scopes; custom resolver scopes must supply one (a stream function cannot be inverted into a Mongo query) — validated at registration.
- **`responseHandler`** on the sync config sanitizes payloads for snapshots and deltas, falling back to the modelRouter `responseHandler`, then the document's `toJSON`.

Scope changes (a doc moves owner/tenant) are handled at write time: `syncPlugin` stamps `_syncPrevStream`, and the change-stream watcher emits a tombstone delta to the previous stream plus a create delta to the new one.

## Write-path restrictions

`syncPlugin` stamps `_syncSeq` on: `save`, `insertMany`, `updateOne`, `findOneAndUpdate`, `replaceOne`, `findOneAndReplace`. These paths **throw** on sync-registered models:

- `updateMany`, `deleteMany` — multi-document writes cannot stamp per-document seqs. Loop per document instead.
- `deleteOne` (query and document forms), `findOneAndDelete` — hard deletes are invisible to tombstone catch-up. Use soft delete (`doc.deleted = true; await doc.save()`).
- `Model.bulkWrite` **bypasses Mongoose middleware entirely**, so the plugin cannot guard it from the schema. `registerSync` instead replaces the static on synced models with one that throws, so the restriction is enforced rather than merely documented. Loop per document instead.

Sequencing guarantees: validation failures never consume a seq (the claim happens post-validation); the claim joins the caller's session when one is present, so caller-managed transactions get counter+write atomicity. A rare write failure after a claim burns a seq, which clients treat as a benign gap.

## Sync protocol

### HTTP (mounted by `SyncApp`, all authenticated)

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /sync/snapshot?collection=&cursor=&limit=` | Bootstrap + catch-up. Returns `{entities: [{id, data, seq, deleted}], cursor, hasMore}`. `cursor=0` = full snapshot (legacy docs without `_syncSeq` arrive in the first page with seq 0). Default page 100, max 100. | Model `list` permissions + server-enforced scope filter |
| `POST /sync/mutate` | HTTP fallback for outbox replay (same handler as the socket channel). Body: `{mutationId, collection, operation, id?, data?, baseVersion?}`. Returns `{ack}` or `{nack}` with status 409 (conflict), 403 (unauthorized), 422 (validation), 429 (rate_limited, carries `retryAfterMs`), 500 (error). | modelRouter create/update/delete write path |
| `POST /sync/mutate/batch` | HTTP fallback for batched outbox replay. Body: `{mutations: SyncMutateRequest[]}` (max 100; intra-batch duplicate `mutationId`s rejected up front). Returns `{results: ({type:"ack",ack}\|{type:"nack",nack})[]}` — applied strictly in array order, stopping at the first non-ack (a shorter `results` array than the request means everything after it was never attempted). | modelRouter create/update/delete write path, per mutation |
| `GET /sync/key` | Caller's per-user key material for the server key provider (32 random bytes, base64; created on first call). | Own key only |

### Socket events (on the `RealtimeApp` Socket.io server)

| Event | Direction | Payload |
|---|---|---|
| `sync:subscribe` / `sync:unsubscribe` | client → server | `{collections: string[]}` — server resolves the user's streams from scope config (+ `getUserScopes`) and joins `sync:{stream}` rooms |
| `sync:subscribed` | server → client | `{collection, streams}` |
| `sync:error` | server → client | `{collection, message}` — per-collection subscribe failure (unknown collection, permission denied, missing resolver, cap exceeded) |
| `sync:delta` | server → client | `{collection, id, method, data?, seq, stream, deleted?}` — emitted by the change-stream watcher |
| `sync:mutate` | client → server | `{mutationId, collection, operation, id?, data?, baseVersion?}` (+ optional Socket.io ack callback) |
| `sync:ack` | server → client | `{mutationId, id, seq}` |
| `sync:nack` | server → client | `{mutationId, code: "conflict"\|"unauthorized"\|"validation"\|"error"\|"rate_limited", serverDoc?, serverSeq?, message?, retryAfterMs?}` — `rate_limited` (with `retryAfterMs`, the remaining window in ms) is never terminal: the client requeues and retries with unlimited backoff, exactly like a transport failure. |
| `sync:mutateBatch` | client → server | `{mutations: SyncMutateRequest[]}` (Socket.io ack callback carries `{results}`, same contract as the HTTP batch route) — a server with no handler for this event never invokes the ack callback, which the client treats as "batching unsupported" after a short grace timeout and falls back to single `sync:mutate` sends. |

Limits: 50 collection subscriptions per socket; 100 `sync:mutate` per second per socket, shared with `sync:mutateBatch` (each mutation in a batch counts individually against the same window); batches capped at 100 mutations.

### Conflicts and idempotency

The client sends `baseVersion` = the `_syncSeq` it last saw for the doc; a mismatch with the current `_syncSeq` yields a `conflict` nack carrying the canonical server doc + seq. The conflict lands in the local `_conflicts` table and surfaces through `useConflicts()`; resolve with `useServer` (accept the server doc) or `keepMine` (re-enqueue with a fresh baseVersion).

`useServer` writes a **tombstone** rather than the server payload when the server side of the conflict is a deletion — either the nack set `serverDeleted`, or it carried no server document at a non-zero `serverSeq` (deleted, hard-deleted, or moved out of this client's scope). Without that, accepting the server side would leave a live local row holding `null` data that lists and renders forever. A conflict with no server document at seq **0** is the opposite case — "server state unknown", the shape startup recovery writes for a conflicted outbox row whose nack was never seen — and never deletes local data. Symmetrically, when the server does still have the document, `useServer` resurrects a local tombstone (a delete that lost the conflict), so accepting the server side always leaves the local row matching it.

Every mutation is idempotent: the handler atomically claims a `SyncMutation` ledger row (unique `mutationId`) before applying, so a re-sent mutation (lost ack, socket retry racing the HTTP fallback) reads back the recorded outcome instead of double-applying.

### Rejected mutations and entity repair

A mutation the server rejects terminally (a `validation` nack, or an `error` nack that exhausts its retry budget) leaves optimistic local data the server never accepted. Since the entity's `seq` never moves in that case, snapshot reconcile has nothing to send and would skip it forever, so the terminal path instead:

1. marks the entity in `_needsRepair`,
2. releases its `pendingMutationId` (a failed mutation never replays, and leaving the lock set would block every future delta for that entity),
3. fetches canonical server state for it (`POST /sync/entities`) and overwrites the local row.

The resulting semantics: a rejected **update** converges back to the server's document. A rejected **create** has no server state to converge to — the repair fetch returns nothing, the mark is cleared (so later reconciles do not re-fetch it forever), and the phantom row is removed by the unknown-stream purge, which deletes rows with no stream provenance and no pending mutation. If the repair fetch itself fails (offline, 5xx), the mark stays and the next reconcile retries it.

`start()` also sweeps entities whose `pendingMutationId` names a mutation with **no `_outbox` row at all** (pruned, wiped, or lost to a partially-persisted store) and clears the lock. Such a row is otherwise frozen for good: the delta applier skips it for pending protection and repair refuses to overwrite it, so nothing else could ever release it.

## Encryption at rest (web)

Web persistence is **encrypted by default**: the store content is AES-256-GCM encrypted via Web Crypto before it touches IndexedDB. Key management is a pluggable `KeyProvider`:

- `createServerKeyProvider({appName, fetchKeyMaterial})` (**the default**: `createSyncDb` wires it automatically to `GET /sync/key` through its authenticated HTTP channel): fetches per-user key material, derives a non-extractable AES-256-GCM key via HKDF-SHA256 (salt = `{appName}:{userId}`), and caches the derived CryptoKey in IndexedDB so offline cold starts still decrypt. Server rotation of key material makes decryption fail — the client wipes local data, re-stamps the schema version, and runs a full re-bootstrap by default (always preceded by a `console.warn`); pass `onDecryptFailure` in `createSyncDb`'s config to override that default (e.g. prompt the user before wiping) instead.
- `createLocalKeyProvider()`: a random non-extractable CryptoKey generated on-device and cached in IndexedDB. No server dependency and no server-side copy of the key — strictly stronger for the at-rest case, at the cost of no server-driven rotation/revocation.

A storage **read** error (IndexedDB itself throwing — unavailable, blocked, or corrupted) is a distinct failure mode from "no data yet" or "undecryptable data": the client leaves the persisted blob untouched (no autosave-over) and surfaces `persistence: "error"` on `SyncStatus` instead of wiping. When `globalThis.indexedDB` is unavailable entirely (private-browsing modes that disable it, a locked-down embedded webview), the web persister factory falls back to in-memory persistence for the session (warns once) and reports `persistence: "memory"`.

```typescript
import {createLocalKeyProvider} from "@terreno/syncdb";

// Default: server-derived key, wired automatically — nothing to configure.
const syncDb = createSyncDb({name: "myapp", collections, authProvider, baseUrl});

// Opt out of the server-side key copy with a device-local key:
const localSyncDb = createSyncDb({
  name: "myapp",
  collections,
  authProvider,
  baseUrl,
  keyProvider: createLocalKeyProvider(),
});
```

**Threat model (stated explicitly):** the web encryption defends against **at-rest disk inspection of IndexedDB** (stolen/imaged device, backup scraping) and against a **stale store being readable after user switch** (per-user keys + wipe-on-user-change). It does **not** defend against XSS or any code executing on the origin — a non-extractable CryptoKey can still be *used* to decrypt in place — and with the server key provider the server can reconstruct any user's key (that is the trade for rotation/revocation; choose the local key provider where that is unacceptable). Server-side data is protected by MongoDB/infra controls, not this layer.

Native relies on the OS app sandbox: the expo-sqlite store is plaintext by design.

## Local store layout

One TinyBase `MergeableStore` per `{app, userId}` (wiped and re-bootstrapped on user change, or on a schema-version mismatch — see below):

```
tables:
  {collection}   → rowId = doc _id; cells: data (JSON string), seq, deleted, deletedAt,
                   pendingMutationId
  _outbox        → rowId = mutationId; cells: collection, operation, entityId, args (JSON),
                   baseVersion?, status (queued|inFlight|acked|conflicted|failed),
                   attemptCount, userId, createdAt, enqueueOrder
  _cursors       → rowId = stream; cells: seq, updatedAt, snapshotSeq, bootstrapped
  _conflicts     → rowId = mutationId; cells: collection, entityId, localData, serverData,
                   serverSeq, serverDeleted, dismissed
values: schemaVersion, lastUserId, outboxMaxEnqueueOrder
```

The outbox replays FIFO over the socket (HTTP fallback while disconnected), with per-user isolation: queued mutations record `userId` and replay skips on mismatch.

A stream's `_cursors` row tracks two independent progress marks. `seq` is the highest seq applied locally and is advanced by both snapshot pages and live deltas; `snapshotSeq` is how far the snapshot endpoint has actually been paged, and only bootstrap advances it. An unfinished bootstrap resumes from `snapshotSeq`, never from `seq`: a live delta at the stream head can overtake `seq` while bootstrap is still on page 3 of 40, and resuming from `seq` would leave every seq in between permanently unreachable (no later reconcile would ask for it again). Once a snapshot pass reaches the head the stream is marked `bootstrapped` and catch-up resumes from `seq`, since deltas carry their own data.

### Schema versioning

`SYNC_SCHEMA_VERSION` (`storage/schema.ts`) is stamped into the store's `schemaVersion` value on every `start()`. If a persisted store's stamped version doesn't match the running client's, the client treats it as a schema migration (not an auth event): wipe all local data, re-stamp the current version, and run a full snapshot re-bootstrap before `start()` resolves. Bump `SYNC_SCHEMA_VERSION` only when a table/cell shape change isn't safely backward-compatible (a new cell with a schema default, for example, does not need a bump).

### Client-side tombstone compaction

Deleted entities are kept locally as tombstones (`deleted: true`) with a `deletedAt` timestamp stamped the moment the tombstone is first applied (via a mutation, a delta, or a snapshot page). After each successful `reconcile()`, tombstones older than `tombstoneRetentionMs` (`createSyncDb` config, default 90 days) are deleted outright. Keep this in sync with the server's own tombstone retention (compaction script in `@terreno/api`) — compacting locally before the server's retention window elapses risks a client permanently missing a delete it hasn't converged on yet. Set `tombstoneRetentionMs: 0` to disable.

### Why MergeableStore (and the Yjs door)

`MergeableStore` is TinyBase's per-cell LWW CRDT (hybrid logical clocks) with a different on-disk format from the plain `Store`. Adopting it from day one avoids a per-device data migration later, and keeps the door open to a Yjs CRDT backend for collaborative structures (rich text) through the same persister/transport abstractions — without implementing Yjs now. The cost is roughly 2× storage overhead for the CRDT metadata, accepted for that readiness.

## Gap handling

Stream seqs are **not** contiguous from any one client's perspective — permission-filtered deltas legitimately skip numbers, and a failed write can burn a seq. Convergence therefore never depends on a gap proof:

- A **seq jump** in an incoming delta is treated as a *hint*: it triggers an HTTP reconcile (snapshot catch-up from the stream cursor), rate-limited to once per 30s per stream (`seqJumpReconcileMinIntervalMs`).
- Every **reconnect** triggers a reconcile plus an outbox replay.
- A **periodic reconcile** (default every 5 minutes, `reconcileIntervalMs`; 0 disables) guarantees convergence even for deltas missed with no observable jump.

Catch-up is a plain indexed query (`_syncSeq > cursor`, tombstones included), safe under concurrent writes because a doc's seq only ever increases.

## Codegen (`terreno-syncdb-codegen`)

For apps using OpenAPI-backed backends, generate typed collection hooks instead of hand-writing entity interfaces and collection strings:

```bash
cd example-frontend && bun run sync-sdk
```

This writes `store/syncDbSdk.ts` with `SYNC_COLLECTIONS`, entity types, and hooks (`useTodos`, `useCreateTodo`, …). Sync-enabled list routes must expose `x-terreno-sync` on `/openapi.json` (emitted by `@terreno/api` when `modelRouter` sets `sync`).

## Known limitations

- **Synced models need a String `_id`** (or clients must mint ObjectId-format ids): offline clients generate entity ids (UUIDs) locally and the mutation channel writes them through as `_id`. A default ObjectId `_id` would cast-fail every client-side create. Declare `_id: {type: String, ...}` on synced schemas.
- **Multi-tab web**: two tabs of the same user share one IndexedDB blob; concurrent persister saves are last-writer-wins at the blob level and can drop the other tab's queued outbox rows. Single-writer coordination (Web Locks) is not implemented yet — avoid relying on offline writes from multiple simultaneous tabs.
- **`Model.bulkWrite` is unavailable on synced models**: it skips Mongoose middleware, so it can never stamp seqs. `registerSync` replaces the static with one that throws — bulk updates to a synced collection have to loop per document.
- **Native plaintext by design**: no SQLCipher; the OS sandbox is deemed sufficient.
- **Whole-store persistence**: each save serializes and (on web) encrypts the full store — cost scales with store size, not change size. Bound it by scoping which collections sync; saves are debounced.
- **`realtime` + `sync` coexistence**: a model may enable both (distinct events, `sync` vs `sync:delta`, so clients never double-apply), at the cost of double emission work. `modelRouter` `realtime` is **deprecated and will be removed in Terreno 58**; use `sync` only.
- **Cold start scales with stream count**: every stream (one collection in one scope) costs at least one `GET /sync/snapshot` round trip, even when empty. Streams page side by side (`snapshotConcurrency`, default 6), so cold start is about `streams / 6` round trips. Sync only the collections the client reads. See [Use syncdb correctly](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/use-syncdb-correctly.md) for this and the write-path pitfalls apps must handle.
- **Seq counter write amplification**: every synced write does an atomic `$inc` on a per-stream counter doc. Acceptable at current scale; Redis-based counters are the documented upgrade path.

## Documentation

Full API reference: [docs/reference/syncdb.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/syncdb.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
