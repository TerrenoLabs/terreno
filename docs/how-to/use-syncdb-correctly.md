# How to Use syncdb Correctly

This page lists `@terreno/syncdb` behavior that a working app has to account for. Each entry says what the library does today, what breaks if you ignore it, and what to do instead. It was checked against `syncdb/src` and `api/src/sync` at 57.13.0. Several entries are library gaps rather than intended behavior. Delete an entry when its gap is fixed.

Read [Local-first data](../explanation/local-first-data.md) and [Migrate from @terreno/rtk to @terreno/syncdb](migrate-rtk-to-syncdb.md) first.

## Startup and snapshots

### Cold start costs one round trip per round, not per stream

A stream is one collection in one scope, so a user has roughly (synced collections) × (tenants they belong to) streams. Reconcile, subscribe catch-up and wipe re-bootstrap page every stream through `POST /sync/snapshot/batch`: one round trip per round, with up to 5,000 rows per response shared across the streams. Empty streams cost nothing extra. `forceResync`, and every pass against a server without the batch route, still page with one `GET /sync/snapshot` per stream, `snapshotConcurrency` streams side by side (default 6). Each stream runs one pass at a time, and a pass that purges (force resync, wipe) waits for the stream's in-flight pass to finish first.

Measured with a fake HTTP channel at 150 ms latency, 13 collections and 2 workspaces (26 streams): 4.1 s to the first full reconcile when paging one stream at a time, 0.95 s at the default concurrency. In a browser with 100 collections and 10k rows, batching cut a reconnect with no changes from 101 requests to 2.

| Do | Why |
| --- | --- |
| Sync only the collections the client reads. | Each collection adds one stream per tenant to cold start. |
| Gate each screen on its **own** stream's bootstrap (see [No loading flag on synced reads](#no-loading-flag-on-synced-reads)), not on "sync finished". | The stream a screen needs may land after others. |
| Don't call `forceResync()` on a hot path. | It purges and re-pages every stream. |
| Raise `snapshotConcurrency` only if the backend can take it. | Without the batch route, each in-flight stream is one concurrent snapshot query on the server. |

The startup reconcile and each collection's `sync:subscribed` catch-up both page the same streams. A catch-up queues behind a pass that started before the room join, because that pass may have missed a write. So a cold start still pages each stream twice, one pass after the other.

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
