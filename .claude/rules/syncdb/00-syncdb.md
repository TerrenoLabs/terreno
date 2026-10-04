---
paths:
  - '**/*'
---
# @terreno/syncdb

Local-first data layer for frontends connecting to `@terreno/api` sync backends. The on-device TinyBase store is the UI source of truth: reads come from local state, writes apply optimistically into a durable outbox, and the server reconciles over socket deltas with HTTP snapshot catch-up. This is a **frontend data** package — no Express, no Mongoose, no backend code.

> **New apps:** use syncdb for collection CRUD. Keep `@terreno/rtk` only for the generated OpenAPI SDK (non-synced routes), Better Auth session Redux, feature flags, and sockets. See [migrate-rtk-to-syncdb.md](../../docs/how-to/migrate-rtk-to-syncdb.md).

## Commands

```bash
bun run syncdb:compile   # Compile TypeScript (from repo root)
bun run syncdb:test      # Run tests (from repo root)
bun run compile          # In syncdb/ package
bun run lint             # Lint code
```

## Architecture

### Entry points

```
syncdb/src/
  index.ts          # createSyncDb, types, betterAuthAdapter, wipeLocalData, ...
  react/index.ts    # SyncDbProvider, useEntity, useQuery, useMutate, ...
  testing/index.ts  # createFakeTransport
```

Import paths:
- `@terreno/syncdb` — client, protocol types, auth adapter, persisters
- `@terreno/syncdb/react` — React hooks (optional peer: `react`)
- `@terreno/syncdb/testing` — test doubles

### File structure (consumer app)

```
store/
  syncdb.ts           # createSyncDb singleton + authProvider
  sdk.ts              # RTK Query API for non-synced routes only
lib/
  betterAuth.ts       # Better Auth client (pairs with betterAuthAdapter)
components/
  SyncTodosScreen.tsx # useQuery / useMutate for synced collections
app/
  _layout.tsx         # syncDb.start() on login, SyncDbProvider
```

## createSyncDb

```typescript
import {baseUrl} from "@terreno/rtk";
import {betterAuthAdapter, createSyncDb} from "@terreno/syncdb";
import {betterAuthClient} from "@/lib/betterAuth";

export const syncDb = createSyncDb({
  authProvider: betterAuthAdapter(betterAuthClient),
  baseUrl,
  collections: ["todos"],
  name: "my-app",
  debug: __DEV__ ? {capacity: 1000} : false,
});
```

Call `syncDb.start()` when the user is authenticated and `syncDb.stop()` on logout. Gate `mutate()` until `start()` resolves.

## React hooks (`@terreno/syncdb/react`)

```typescript
import {
  SyncDbProvider,
  useEntity,
  useQuery,
  useEntityIds,
  useMutate,
  useSyncStatus,
  useConflicts,
} from "@terreno/syncdb/react";
```

| Hook | Purpose |
|------|---------|
| `useEntity(collection, id)` | Single row; `{data, deleted, seq, isPending}` |
| `useQuery(collection, options?)` | Local `where`/`filter`/`sort`/`limit` entity array |
| `useEntityIds(collection, options?)` | Stable id list for large lists |
| `useWindowQuery(collection, options?)` | Server-filtered paged list for `queryCollections` (RTK list args: `where`, `sort`, `pageSize`, `fetchNextPage`) |
| `useMutate(collection)` | `{create, update, remove}` — local-first writes |
| `useSyncStatus()` | Online, syncing, queued count, conflict count |
| `useConflicts()` | `{conflicts, resolve}` with `useServer` / `keepMine` |

Wrap synced screens in `SyncDbProvider`:

```tsx
<SyncDbProvider client={syncDb}>
  <TodoList />
</SyncDbProvider>
```

## Backend requirements

Every synced collection needs on the server:

1. `isDeletedPlugin` + `syncPlugin` on the Mongoose schema
2. `modelRouter("/path", Model, {sync: {...}, permissions, ...})` (three-argument form)
3. `SyncApp` + `RealtimeApp` registered on the Express app
4. MongoDB **replica set** (change streams)

See `docs/reference/syncdb.md` for `sync` scoping (`owner`, `tenant`, `broadcast`, `getUserScopes`).

## Conventions

- **Local-first only** — no server-first mode; do not wait on HTTP for reads/writes of synced collections
- **Delete RTK Query hooks** for migrated collections (`useGetXQuery`, `usePostXMutation`, manual optimistic updates, refetch-after-mutate)
- **Keep RTK Query** for non-synced routes: `/auth/me`, AI, feature flags, and
  custom request/response APIs. Built-in admin String-`_id` collection CRUD uses
  windowed syncdb when `adminBroadcast` is enabled; admin RPC uses its host-bound
  fetch client; ObjectId compatibility CRUD remains RTK until Terreno 58.
- Use `useSyncDbReady()` (or equivalent) before calling `mutate()` if `start()` is async
- Call `wipeLocalData` / `syncDb.stop()` on user change to avoid cross-account local data
- Use Luxon for dates in entity payloads
- Use `console.info/debug/warn/error` for permanent frontend logs
- Native: `bunx expo install expo-sqlite` in the **app** and rebuild native

## Testing

- Framework: `bun test` with `expect` in `syncdb/`
- Use `createFakeTransport` from `@terreno/syncdb/testing` for unit tests
- E2E: see `example-frontend/e2e/syncdb-*.spec.ts`

## Runtime debugging

Use the `debug-syncdb-with-mcp` skill for stale entities, outbox stalls,
conflicts, cursor/stream drift, reconcile behavior, and offline replay. A client
created with `debug: true` registers itself with `terreno-mcp-local`.

- `get_syncdb_state` reads debugger events plus entities, outbox, conflicts,
  cursors, streams, repair markers, and aggregate status.
- `syncdb_snapshot` captures and compares state; captures can later be CRDT-merged.
- `syncdb_action` mutates, flushes, reconciles, resyncs, resolves, retries, toggles
  offline mode, directly edits local rows, or merges snapshots. State changes
  require `TERRENO_MCP_EVAL=1`.

See `docs/how-to/debug-with-mcp.md`.

## Environment variables

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_API_URL` | Backend base URL (via `@terreno/rtk` `baseUrl`) |
| `BETTER_AUTH_*` | Session auth for `betterAuthAdapter` (see api Better Auth docs) |

## Related

- [syncdb reference](../../docs/reference/syncdb.md)
- [Migration guide](../../docs/how-to/migrate-rtk-to-syncdb.md)
- [Local-first explainer](../../docs/explanation/local-first-data.md)
