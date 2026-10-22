---
targets: ["cursor", "devin", "copilot", "claudecode"]
description: "@terreno/syncdb - Frontend data, request, and session layer for Terreno apps"
globs: ["**/*"]
---

# @terreno/syncdb

The only frontend data layer for `@terreno/api` backends. Synced collections live in an on-device TinyBase store that is the UI source of truth: reads come from local state, writes apply optimistically into a durable outbox, and the server reconciles over socket deltas with HTTP snapshot catch-up. Every other route goes through the syncdb request client and generated hooks. syncdb also owns the auth session, feature flags, socket events, and app utilities. This is a **frontend** package — no Express, no Mongoose, no backend code.

> `@terreno/rtk` and Redux were removed in Terreno 58. Never add them. Upgrade path: [migrate-rtk-to-syncdb.md](../../docs/how-to/migrate-rtk-to-syncdb.md).

## Commands

```bash
bun run syncdb:compile   # Compile TypeScript (from repo root)
bun run syncdb:test      # Run tests (from repo root)
bun run compile          # In syncdb/ package
bun run lint             # Lint code
```

## Architecture

### Entry points

| Import path | Source | Exports |
|-------------|--------|---------|
| `@terreno/syncdb` | `src/index.ts` | `createSyncDb`, protocol types, `betterAuthAdapter`, `wipeLocalData`, persisters |
| `@terreno/syncdb/react` | `src/react/index.ts` | `SyncDbProvider`, `useQuery`, `useMutate`, `useSyncStatus`, `useConflicts`, `useSocketEvent`, `ApiClientProvider`, `useApiQuery`, `useLazyApiQuery`, `useApiMutation` |
| `@terreno/syncdb/api` | `src/api/client.ts` | `createApiClient`, `ApiError`, `apiFetch` |
| `@terreno/syncdb/auth` | `src/auth/auth.ts` | `createBetterAuthClient`, `SessionProvider`, `useSession`, `jwtAuthAdapter`, `useJwtAuth`, token-expiry helpers |
| `@terreno/syncdb/config` | `src/config/baseUrl.ts` | `baseUrl`, `baseWebsocketsUrl`, `resolveBaseUrls`, `appHeaders` |
| `@terreno/syncdb/flags` | `src/flags/useFeatureFlags.ts` | `useFeatureFlags`, `useTerrenoFeatureFlags` |
| `@terreno/syncdb/app` | `src/app/app.ts` | `useUpgradeCheck`, `hasPermission`, `canOpenAdminPage`, `installDevConsoleLogger`, `useMCPTools` |
| `@terreno/syncdb/buildNumber` | `src/buildNumber.ts` | `resolveBuildNumber` (node-only, for `app.config.ts`) |
| `@terreno/syncdb/codegen` + bin `terreno-syncdb-codegen` | `src/codegen/` | `--out` synced collection hooks, `--api-out` request hooks |
| `@terreno/syncdb/testing` | `src/testing/index.ts` | `createFakeTransport` |

Every subpath's peer dependencies are optional; a subpath imports only what it needs.

### File structure (consumer app)

```
store/
  syncdb.ts           # createSyncDb singleton + shared authProvider
  apiClient.ts        # createApiClient (same authProvider)
  apiSdk.ts           # Generated request hooks (terreno-syncdb-codegen --api-out; DO NOT EDIT)
  syncDbSdk.ts        # Generated collection hooks + SYNC_COLLECTIONS (--out; DO NOT EDIT)
lib/
  betterAuth.ts       # createBetterAuthClient from @terreno/syncdb/auth
components/
  SyncTodosScreen.tsx # useQuery / useMutate for synced collections
app/
  _layout.tsx         # SessionProvider, ApiClientProvider, SyncDbProvider; syncDb.start() on login
```

## createSyncDb

```typescript
import {betterAuthAdapter, bridgeBetterAuthReactClient, createSyncDb} from "@terreno/syncdb";
import {createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {betterAuthClient} from "@/lib/betterAuth";

export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient));

export const syncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: ["todos"],
  name: "my-app",
  debug: __DEV__ ? {capacity: 1000} : false,
  wipeOnSignOut: true,
});

export const apiClient = createApiClient({authProvider, baseUrl, headers: appHeaders});
```

Mount `<SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]}>` and
`<ApiClientProvider client={apiClient}>` at the root. Read the session with `useSession()`.

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
| `useWindowQuery(collection, options?)` | Server-filtered paged list for `queryCollections` (`where`, `sort`, `pageSize`, `fetchNextPage`) |
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
- **Collections:** `useQuery` / `useMutate`. No request hooks, manual optimistic updates, or refetch-after-mutate for synced collections.
- **Non-synced routes** (`/auth/me`, AI, actions, consents): generated `store/apiSdk.ts` hooks, or `useApiQuery` / `useApiMutation` for a route not in OpenAPI. Never `axios` or raw `fetch` in screens. Built-in admin String-`_id` collection CRUD uses windowed syncdb when `adminBroadcast` is enabled; other admin requests use admin-frontend's host-bound fetch client (`AdminProvider`).
- **One socket:** server pushes use `useSocketEvent` / `syncDb.onSocketEvent`; flags pass `socket: syncDb`.
- **Change the codegen, then regenerate** — never edit `store/apiSdk.ts` or `store/syncDbSdk.ts`.
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
| `EXPO_PUBLIC_API_URL` | Backend base URL (via `@terreno/syncdb/config` `baseUrl`) |
| `EXPO_PUBLIC_DEV_API_PORT` | Local dev API port (default `4000`) |
| `BETTER_AUTH_*` | Session auth for `betterAuthAdapter` (see api Better Auth docs) |

## Related

- [syncdb reference](../../docs/reference/syncdb.md)
- [Migration guide](../../docs/how-to/migrate-rtk-to-syncdb.md)
- [Local-first explainer](../../docs/explanation/local-first-data.md)
