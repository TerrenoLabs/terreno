# How to Use syncdb Correctly

This page lists `@terreno/syncdb` behavior that a working app has to account for. Each entry says what the library does today, what breaks if you ignore it, and what to do instead. It was checked against `syncdb/src` and `api/src/sync` at 57.13.0. Where an entry is a library gap rather than intended behavior, it says so. Delete the entry when the gap is fixed.

Read [Local-first data](../explanation/local-first-data.md) and [Migrate from @terreno/rtk to @terreno/syncdb](migrate-rtk-to-syncdb.md) first.

## Startup and snapshots

### Snapshots page one stream at a time (library gap)

Every snapshot path in `syncdb/src/client.ts` awaits `bootstrapStream` for one stream before it starts the next. That applies to `runReconcile`, `catchUpSubscribedStreams`, `forceResync` and `wipeAndRebootstrap`. A stream is one collection in one scope, so the number of streams is roughly the number of synced collections times the number of tenants the user belongs to. Each stream costs at least one `GET /sync/snapshot` round trip, even when it is empty.

Measured with a fake HTTP channel at 150 ms latency, 13 collections and 2 workspaces (26 streams): 26 snapshot requests, at most **1** in flight, 4.1 s before the first reconcile finished. A parallel pass would take roughly two round trips.

`HttpChannel` has no queue or concurrency limit, and the server's snapshot route is stateless per request. The serialization comes only from the client's loops.

Until this is fixed:

| Do | Why |
| --- | --- |
| Sync only the collections the client reads. | Each collection adds one round trip per tenant to cold start. |
| Gate each screen on its **own** stream's bootstrap (see [No loading flag on synced reads](#no-loading-flag-on-synced-reads)), not on "sync finished". | The stream a screen needs may be last in the serial order. |
| Don't call `forceResync()` on a hot path. | It purges and re-pages every stream serially, and waits for lifecycle idle after each one. |

The fix belongs in `client.ts`: run a bounded pool (about 4 workers) over the stream list. Each worker should check `isSuperseded()` before taking a stream. Run `compactTombstones` and `repairAllMarkedEntities` only after every stream succeeds. Rethrow `AuthRequiredError` first so the pool still auth-pauses. `syncStreams` (leaves and joins) must still finish before any paging starts.

### The same stream can be paged twice at once (library gap)

`catchUpSubscribedStreams` deliberately bypasses the `reconcile()` coalescer, and nothing dedupes passes per stream. At startup the socket sends one `sync:subscribed` per collection. Each one starts a catch-up that runs alongside the startup reconcile, so a cold start pages most streams twice.

This is usually harmless. Cursors only move forward, and entity applies are seq-guarded. The exception is a purge that lands during another pass on the same stream. That purge can come from `forceResync`, from the retention-gap check in `bootstrapStream`, or from a membership leave. The other pass then writes its high cursor back and marks the stream `bootstrapped`. If the purging pass then fails, the stream is marked complete but is missing every row below that cursor.

Don't call `forceResync()` while a reconcile or reconnect is in flight. The library fix is a per-stream single-flight map. `forceResync` should await the in-flight pass before it purges, and catch-up should chain one more pass after the in-flight one.

### No loading flag on synced reads

`useQuery` returns a plain array. `useListQuery` returns `{data}`. The `isPending` on `useEntity`/`useReadQuery` means an outbox write is pending, not that data is loading. An empty array before bootstrap looks the same as an empty collection, so a screen that renders its empty state from `[]` flashes "nothing here" on every cold start.

The per-stream `bootstrapped` mark is the right signal, but `isStreamBootstrapped` is not exported. Read the cell directly:

```typescript
const isBootstrapped = (stream: string): boolean =>
  syncDb.store.raw.getCell("_cursors", stream, "bootstrapped") === true;
```

Don't use the cursor (`useSyncStatus().streams`) for this. A live delta can move the cursor to the head before the snapshot below it has been paged. `useWindowQuery` (query collections only) does expose `isLoading`.

A stream key is `<collection>|<scopeType>:<value>`, for example `documents|tenant:<workspaceId>`. A user with several tenants has one stream per tenant. Treat a collection as loaded only once every known stream for it is bootstrapped (`syncDb.store.getKnownStreams()`).

## Writes

### Mutations return an id, not an outcome

`create`, `update` and `remove` from `useMutate` (and from the generated `useCreate*`/`useUpdate*`/`useDelete*` hooks) return `{mutationId, id}` synchronously. There is no promise for the server ack. The client also drops the ack's `warning`. A `warning` means a server post-hook threw after the write committed.

If a screen needs to know the outcome (close a modal only once the create landed, toast a refusal), wrap the transport and HTTP channel and record ack and nack outcomes by `mutationId`. Then await that `mutationId`. Don't poll the store.

### A 403 from a write halts the whole outbox

The server maps 403/405 to an `unauthorized` nack and 400/404/422 to `validation`. They behave very differently:

| Nack | Client behavior |
| --- | --- |
| `unauthorized` | The mutation is re-queued and the **whole drain stops** (auth-pause). On re-auth the same `mutationId` replays, reads the same stored nack, and pauses again. It never settles. |
| `validation` | The mutation is marked `failed` and the drain continues. That entity's later writes stay blocked until `retryFailed({entityId})`. |
| `conflict` | That entity's later writes stay blocked (or every write is blocked, with `haltQueueOnConflict: true`) until `resolveConflict`. |
| `error` | Retried up to the retry budget, then handled like `validation`. |

So a router hook that refuses a synced write for a business reason must throw **422**, not 403. That includes `preCreate`/`preUpdate` membership checks. Keep 403 for real auth failures.

### Don't send a stale tenant field on create

For a tenant-scoped collection, `enforceWriteScope` checks a client-sent scope field (for example `workspaceId`) against the user's memberships **before** `preCreate` runs. A value the user does not belong to is a 403, which halts the outbox (see above). If the field is missing or null, the check is skipped and `preCreate` can fill it in.

Either omit the tenant field and let `preCreate` set it, or send it only from the currently synced row of the parent tenant, never from a persisted id that may be stale.

### The local row never gets server-computed fields from the create

After an ack, the client stamps the row with the ack's seq and keeps the optimistic data. The server's create delta has the same seq, so the client skips it. Whatever `preCreate`, schema defaults or hooks set on the server does not reach the local row until that row changes again or is repaired. If the delta arrives before the ack, the row is marked for repair, but repair only runs on the next `reconcile()` (reconnect, seq jump, or every 5 minutes).

Do one of these:

- Send every field the UI reads in the create payload, matching what the server would compute (defaults, `order`, ownership fields).
- After the ack, patch the local row yourself.

The local row's `data` is exactly what you passed. Include `_id` in the payload if anything reads `row._id`. Server-written rows carry `_id` and `id`.

### A refused create leaves a phantom row

When a create is nacked as `validation` (or runs out of `error` retries), the repair fetch finds no server row and only clears the repair mark. The optimistic row stays in the store with `stream: ""` and shows up in queries. Only `forceResync` purges such rows.

On a refused create, tombstone the local row yourself and call `retryFailed({entityId})` so later writes to that id are released.

### Conflicts are never resolved for you

A `conflict` nack blocks every later write to that row, and any queued write whose args mention its id, until someone calls `client.resolveConflict({mutationId, strategy: "keepMine" | "useServer"})` (or `useConflicts().resolve`). Local edits keep applying optimistically, so the UI looks fine while nothing reaches the server.

If the app has no conflict UI, run a watcher that resolves each conflict as it is recorded. Use `keepMine` for fields the user types, and `useServer` for everything else.

## Server side

### Write synced models one document at a time, by `_id`

On a synced model, `updateMany`, `deleteMany`, `deleteOne`, `findOneAndDelete` and `bulkWrite` throw. Single-document writes by `_id` without upsert are allowed: `save()`, `updateOne`, `findOneAndUpdate`, `findByIdAndUpdate`, `replaceOne`. Delete by setting `deleted: true`, because a hard delete emits no delta.

In tests, clean up with `Model.collection.deleteMany(...)`, which bypasses Mongoose.

### Deltas don't apply `queryFilter`

Snapshots and `/sync/entities` apply the router's `queryFilter`. Live deltas check only `permissions.read` (or RBAC) per recipient. A router that restricts visibility only through `queryFilter` leaks rows over the socket. Every synced router's `read` permission must enforce the same restriction itself.

### Membership grants arrive late

A user's new tenant is picked up by the socket's session revalidation sweep (`sessionRevalidationIntervalMs`, 60 s by default) or a resubscribe. The client finds the new stream on its next `reconcile()` (`reconcileIntervalMs`, 5 minutes by default, plus reconnects). Until then the new tenant's rows don't appear.

When the product grants membership, push a content-free event to the user's sockets and have the client reconnect syncdb. Reconnecting resubscribes and reconciles. Grants written another way (admin, scripts) still wait for the timers.

## Auth

### Logging out does not wipe local data

The client's own `onAuthChange` handling treats a logout as a pause and **never wipes**. A different user logging in does wipe. To clear one user's data on sign-out, set `wipeOnSignOut: true` and call `client.signOut()` explicitly when the app's user clears.
