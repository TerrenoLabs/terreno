# Local-first data in Terreno

Terreno's default frontend data path is **local-first**: the on-device store is what your UI reads and writes, and the server reconciles changes asynchronously. This is a different mental model from request/response fetching with RTK Query.

## What local-first means here

In `@terreno/syncdb`, a TinyBase `MergeableStore` on the device is the **UI source of truth**. When a user taps "save," the mutation applies to local state immediately and lands in a durable outbox. The client then pushes the change to `@terreno/api` over the sync protocol (socket deltas with HTTP snapshot catch-up). The server remains the **authority** for permissions, validation, and conflict resolution — but the UI does not wait on the network for every write.

There is no server-first mode and no opt-in flag: if you use syncdb, you adopt this model for every synced collection.

## Mental model shift

| Server-first (RTK Query) | Local-first (syncdb) |
|--------------------------|----------------------|
| UI reads from cache filled by HTTP | UI reads from the local store |
| Writes call the API, then invalidate/refetch | Writes apply locally, then reconcile |
| Loading spinners track request lifecycle | Sync status tracks outbox + connectivity |
| Optimistic updates are manual and fragile | Optimistic state is the default path |
| Conflicts are rare / ignored | Conflicts are explicit and must be resolved |

Think **apply locally, then reconcile** instead of **request, wait, update cache**.

## What you stop doing

1. **Manual optimistic updates** — `onQueryStarted` patches, temporary IDs, and rollback logic for writes.
2. **Write-level loading spinners** — `isLoading` on mutations for "saving…" UX; the row updates instantly.
3. **Refetch orchestration** — `invalidatesTags`, `refetch()`, and list/detail cache coordination after mutations.
4. **Treating the network as the read path** — list screens blocked on `isLoading` for every navigation.

RTK Query remains appropriate for **non-synced generated** endpoints such as
`/auth/me` and AI routes. Built-in admin RPC stays request/response through its
host-bound fetch client; ObjectId/API-only admin CRUD keeps RTK compatibility in
Terreno 57.

## What you start doing

1. **Conflict resolution UI** — When the server rejects a mutation (409 / `sync:nack`), the user must choose a strategy (`useServer` or `keepMine`). Use `ConflictSheet` from `@terreno/ui` or build your own with `useConflicts`.
2. **Sync-status UX** — Surface offline state, queued mutations, and drain progress with `useSyncStatus` (and optionally `SyncStatusBanner`).
3. **Encryption at rest (web)** — Web persistence uses AES-GCM via the default `createServerKeyProvider`; understand key fetch and `onDecryptFailure` for support flows.
4. **Key lifecycle on logout** — Call `syncDb.stop()` and consider `wipeLocalData` when the authenticated user changes so one account does not read another's local store.
5. **Backend sync registration** — Every synced collection needs `syncPlugin`, `isDeletedPlugin`, and a `sync` block on `modelRouter`, plus `SyncApp` and `RealtimeApp` on the server. Optional `sync.adminBroadcast: true` also emits `sync:delta` to `{collection}|admin`. Admin clients subscribe with `mode: "window"` (`createSyncDb({windowCollections})`) so they do not snapshot or reconcile that collection; they call `hydrateWindow` (REST membership ids + `GET /sync/entities`). Pass the same `accessControl` into `SyncApp` that `AdminApp` uses so `{collection}|admin` requires `admin:access`. `AdminApp.register` also installs that model's admin list/read/`queryFilter` on the admin window so hydrate and live `|admin` deltas match `/admin` REST. Without RBAC, `user.admin` is enough for the shell gate. Live deltas on that stream apply only to ids already in the window; Refresh is a REST re-query plus `hydrateWindow`.
6. **Collections too large to sync whole** — List them in `createSyncDb({queryCollections})`. They skip snapshot bootstrap; screens load server-filtered *query windows* (`useWindowQuery`) from the `modelRouter` list endpoint. A window stores only membership (ordered ids); rows live once in the shared entity table. Overlapping windows therefore share rows — one delta updates both views — while each view lists only its own query's members, plus cached rows that newly match its `where` inside the loaded range. Live deltas still arrive on the user's normal streams; windows on screen refetch on reconnect to cover deltas missed offline.

## Tradeoffs

**Gains:** instant UI, offline writes with a durable outbox, simpler screen code, and one write path on the server (sync and REST share `modelRouter`).

**Costs:** larger conceptual surface (conflicts, sync status, local storage), mandatory replica-set MongoDB for realtime, and migration work for existing RTK Query screens.

Server-first fetching is simpler when you only need online CRUD with no offline requirement — but Terreno's blessed path for collection data is local-first.

## Related docs

- [syncdb reference](../reference/syncdb.md) — API ground truth
- [Migrate from RTK to syncdb](../how-to/migrate-rtk-to-syncdb.md) — step-by-step migration
- [Authentication architecture](authentication.md) — Better Auth + socket sessions
