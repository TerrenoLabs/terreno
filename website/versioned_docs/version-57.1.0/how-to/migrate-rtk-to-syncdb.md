# How to Migrate from @terreno/rtk to @terreno/syncdb

This guide is **AI-context-first**: it is written for an agent (or human) performing a screen-by-screen migration, not as a codemod. Work through one concern at a time — reads, then writes, then conflicts, then sync-status UX — and delete RTK-era code as you go.

`@terreno/syncdb` supersedes `@terreno/rtk` for **data synchronization** (CRUD reads/writes, offline queue, realtime convergence). It does not replace the generated OpenAPI SDK, Better Auth Redux wiring, or feature-flag infrastructure.

## 1. Before you start

| Decision | Requirement | Why |
|----------|-------------|-----|
| **Better Auth first?** | Recommended before or in parallel with data migration | `betterAuthAdapter` is the shipped `AuthProvider`; socket sessions work cleanly with `RealtimeApp({betterAuth})`. Legacy JWT sockets still work during transition. |
| **Backend version** | `@terreno/api` with `SyncApp`, `RealtimeApp`, `syncPlugin`, `isDeletedPlugin` | Without backend sync registration, the client has nothing to talk to. |
| **MongoDB replica set** | Required for `RealtimeApp` change streams | Single-node replset is fine for dev. |
| **Per-collection rollout** | One synced collection at a time | REST and sync share the same write path; migrate screen-by-screen. |
| **Redux** | Keep Redux for auth, feature flags, app state; drop RTK Query for migrated collections | See §2. |

**Auth can migrate before data (M3).** A typical two-step order:

1. **Step A — Auth:** Move login/session to Better Auth (`generateBetterAuthSlice`, `betterAuthAdapter`, `syncDb.start()` on login). Screens can still read/write via RTK Query during this step.
2. **Step B — Data:** For each collection, replace RTK Query hooks with syncdb hooks and delete the RTK path for that screen.

The example app completed both steps; todos are syncdb-only while profile/admin still use generated RTK hooks.

**Validation (Task 3.5):** The profile screen (`example-frontend/app/(tabs)/profile.tsx`) was reviewed against this guide. `useGetMeQuery` / `usePatchMeMutation` are **non-synced** custom SDK routes — the guide §8 explicitly says to keep them on RTK. No profile migration is required; the guide is sufficient for that case.

Reference: [`docs/reference/syncdb.md`](../reference/syncdb.md), and the package [`syncdb/README.md`](https://github.com/TerrenoLabs/terreno/blob/release-56.0.0/syncdb/README.md).

## 2. Install and configure

### Install packages

```bash
bun install @terreno/syncdb
bunx expo install expo-sqlite   # native persistence — install in the app, rebuild native
```

### Create the sync client

**After** (`example-frontend/store/syncdb.ts`):

```typescript
import {baseUrl} from "@terreno/rtk";
import {betterAuthAdapter, createSyncDb} from "@terreno/syncdb";
import {betterAuthClient} from "@/lib/betterAuth";

const authProvider = betterAuthAdapter(betterAuthClient, {pollIntervalMs: 60_000});

export const syncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: ["todos"],
  name: "terreno-example",
  debug: __DEV__ ? {capacity: 1000} : false,
});
```

### Start/stop on auth

**After** (`example-frontend/app/_layout.tsx`):

```typescript
useEffect(() => {
  if (!userId) {
    return;
  }
  let stopped = false;
  syncDb
    .start()
    .then(() => {
      if (!stopped) {
        setSyncDbReady(true);
      }
    })
    .catch((error) => {
      console.error("[syncdb] Failed to start client", error);
    });
  return () => {
    stopped = true;
    setSyncDbReady(false);
    void syncDb.stop();
  };
}, [userId, syncDbStartAttempt]);
```

Gate writes with a ready flag (`useSyncDbReady`) so `mutate()` is not called before `start()` resolves a user.

### Wrap screens with `SyncDbProvider`

**After** (`example-frontend/app/(tabs)/index.tsx`):

```tsx
import {SyncDbProvider} from "@terreno/syncdb/react";
import {syncDb} from "@/store/syncdb";

const TodosScreen = () => (
  <SyncDbProvider client={syncDb}>
    <SyncTodosScreen />
  </SyncDbProvider>
);
```

The example also mounts `SyncDbProvider` at the root (`_layout.tsx`) for `SyncHealthToast`.

### Redux store: keep vs remove

| Keep on Redux | Remove for migrated collections |
|---------------|--------------------------------|
| `generateBetterAuthSlice` / session | `generateAuthSlice` (JWT) once Better Auth ships |
| `terrenoApi` reducer for **non-synced** routes | `useGetTodosQuery` / todo mutations |
| `createOfflineMiddleware` + offline slice | `realtimeList` / `realtimeDocument` for that collection |
| Feature-flag / app-state slices | Per-screen `isLoading` spinners tied to RTK mutations |

**Before** (`origin/master:example-frontend/store/index.ts`): `generateAuthSlice`, `createOfflineMiddleware`, offline payload sessionStorage.

**After** (`example-frontend/store/index.ts`): `generateBetterAuthSlice`, `terrenoApi` only — no offline middleware.

## 3. Reads

There is no `isLoading` for reads after bootstrap — data is already in the local store.

### List reads

**Before** (`origin/master:example-frontend/app/(tabs)/index.tsx`):

```typescript
const {data: todosData, isLoading, refetch, isFetching} = useGetTodosQuery({}, {skip: !userId});
const todos = todosData?.data ?? [];
```

**After** (`example-frontend/components/SyncTodosScreen.tsx`):

```typescript
import {useEntity, useEntityIds} from "@terreno/syncdb/react";

const incompleteIds = useEntityIds<SyncTodo>("todos", {
  filter: (t) => !t.completed,
  sort: sortByCreatedDesc,
});

// Per row:
const {data} = useEntity<SyncTodo>("todos", id);
```

For small lists, `useQuery` is fine:

```typescript
import {useQuery} from "@terreno/syncdb/react";
const todos = useQuery<Todo>("todos", {filter: (t) => !t.completed});
```

`filter` / `sort` run in JS — there are no server query params. Tombstones are excluded unless `{includeDeleted: true}`.

### Delete this RTK read code

- `useGetTodosQuery` / `useGet*Query` for the migrated collection
- `isLoading`, `isFetching`, `refetch`, `RefreshControl` wired to list fetch
- `skip: !userId` guards on list queries (replace with `useSyncDbReady` on writes; reads are safe once bootstrapped)
- `realtimeList("todos")` / `realtimeDocument("todos")` in `store/sdk.ts` for that collection

## 4. Writes

Writes are synchronous from the UI's perspective: local apply + outbox enqueue + background replay.

### Create / update / delete

**Before** (`origin/master:example-frontend/app/(tabs)/index.tsx`):

```typescript
const [createTodo, {isLoading: isCreating}] = usePostTodosMutation();
const [updateTodo] = usePatchTodosByIdMutation();
const [deleteTodo] = useDeleteTodosByIdMutation();

await createTodo({title, completed: false}).unwrap();
await updateTodo({id, completed: true}).unwrap();
await deleteTodo(id).unwrap();
```

**After** (`example-frontend/components/SyncTodosScreen.tsx`):

```typescript
import {generateMutationId} from "@terreno/syncdb";
import {useMutate} from "@terreno/syncdb/react";

const {create, update, remove} = useMutate("todos");

const id = generateMutationId();
create({data: {_id: id, title, completed: false, created: DateTime.now().toISO()}});
update({id, data: {completed: true}});
remove({id});
```

Client-minted `_id` on creates lets the optimistic row render before the server acks.

### Delete this RTK write code

- `usePost*Mutation`, `usePatch*Mutation`, `useDelete*Mutation` for the migrated collection
- `.unwrap()` / try-catch around mutation promises for happy-path UX
- **`isLoading` / `isCreating` / `isUpdating` spinners on write buttons** — syncdb writes do not await the server
- Manual optimistic cache updates (`updateQueryData`, `upsertQueryData`, temporary local rows in component state)
- `refetch()` or tag invalidation after mutate (`invalidatesTags` for that collection)
- `createOfflineMiddleware` endpoint list entries for that collection (`configureOfflineMutationEndpoints`)
- `If-Unmodified-Since` / 409 handling in custom mutation code (conflicts move to `useConflicts()`)

Server rejection surfaces later as outbox nacks — conflicts in `useConflicts()`, terminal failures in `getSyncStatus().failedCount`.

## 5. Conflicts

A **conflict** means the client's `baseVersion` (last seen `_syncSeq`) disagrees with the server. The server returns a `conflict` nack:

- HTTP: `POST /sync/mutate` → **409** with `{nack: {code: "conflict", serverDoc, serverSeq, ...}}`
- Socket: `sync:nack` with `code: "conflict"`

The client records the conflict locally; the UI must let the user pick a side.

### Strategies

| Strategy | When to use |
|----------|-------------|
| `useServer` | Accept canonical server data (or tombstone if server deleted the doc) |
| `keepMine` | Re-enqueue local changes with a fresh `baseVersion` |

```typescript
import {useConflicts} from "@terreno/syncdb/react";

const {conflicts, resolve} = useConflicts();
resolve({mutationId, strategy: "useServer"});
resolve({mutationId, strategy: "keepMine"});
```

### Minimum UI

The example app uses:

- `SyncConflictsController` — single app-wide sheet state (`example-frontend/components/SyncConflictsController.tsx`)
- `ConflictSheet` rendered from `SyncHealthToast` (`example-frontend/app/_layout.tsx`)
- `SyncStatusBanner` conflict badge → `openConflicts("todos")` (`example-frontend/components/SyncTodosScreen.tsx`)

Copy that pattern or build equivalent: show local vs server fields, two resolution actions, block further edits on conflicted entities until resolved.

## 6. Sync status

Replace **request-loading UX** with **sync-state UX**.

| RTK era | Syncdb era |
|---------|------------|
| `isLoading` on queries | No list loading spinner (data is local) |
| `useOfflineStatus` / `useServerStatus` | `useSyncStatus()` |
| `OfflineBanner` on fetch failure | `SyncStatusBanner` + `SyncHealthToast` |
| Pull-to-refresh `refetch()` | Optional `client.forceResync()` for support tooling |

**After** (`example-frontend/components/SyncTodosScreen.tsx`):

```typescript
import {useSyncStatus} from "@terreno/syncdb/react";
import {SyncStatusBanner} from "@terreno/ui";

const syncStatus = useSyncStatus();

<SyncStatusBanner
  isOnline={syncStatus.isOnline}
  queuedCount={syncStatus.queuedCount}
  conflictCount={syncStatus.conflictCount}
  failedCount={syncStatus.failedCount}
  paused={syncStatus.paused}
  draining={syncStatus.draining}
  sentThisDrain={syncStatus.sentThisDrain}
  totalThisDrain={syncStatus.totalThisDrain}
  onOpenConflicts={openConflictSheet}
  onAuthRequired={handleAuthRequired}
/>
```

`SyncHealthToast` (`example-frontend/components/SyncHealthToast.tsx`) adds persistent toasts for per-collection conflicts/failures and an initial "Syncing…" toast with optional force reload.

`paused: "auth"` means replay is halted until the same user re-authenticates — wire `onAuthRequired` to your login flow.

## 7. Auth

**Auth can ship before data migration.** Complete Better Auth + `betterAuthAdapter` first; keep RTK Query for reads/writes until each screen migrates.

### Better Auth adapter

**After** (`example-frontend/store/syncdb.ts`):

```typescript
import {betterAuthAdapter, createSyncDb} from "@terreno/syncdb";
import {betterAuthClient} from "@/lib/betterAuth";

const authProvider = betterAuthAdapter(syncAuthClient, {pollIntervalMs: 60_000});

export const syncDb = createSyncDb({authProvider, baseUrl, collections: ["todos"], name: "terreno-example"});
```

`betterAuthAdapter` implements `AuthProvider`:

- `getToken()` / `getUserId()` — read session per request (not cached)
- `onAuthChange` — session atom subscription (example bridges `$store.atoms.session`)
- `refresh()` — one silent refresh per auth-pause episode

### Token storage

Better Auth session tokens live in the Better Auth client (`@terreno/rtk` `createBetterAuthClient`):

- **Native:** `expo-secure-store`
- **Web:** `@react-native-async-storage/async-storage`

Syncdb does not store tokens itself — it calls `authProvider` on every transport/HTTP request.

### Socket auth and `sync:auth-expired`

On connect, the socket transport sends the bearer token from `getToken()`. When the server's session re-validation sweep finds an expired/disabled session, it emits `sync:auth-expired` then disconnects (`api/src/realtime/sessionRevalidation.ts`). The client maps this to `paused: "auth"` — **no local wipe**, outbox preserved (INV-2).

### Backend

```typescript
new RealtimeApp({betterAuth: {auth, userModel: User}})
```

Required for Better Auth socket sessions. Legacy JWT sockets continue to work without it.

## 8. Codegen

Synced collections use `bun run sync-sdk`, which runs `terreno-syncdb-codegen` from
`@terreno/syncdb`. It reads `/openapi.json`, finds list operations tagged
`x-terreno-sync`, and writes `store/syncDbSdk.ts` (`SYNC_COLLECTIONS` plus friendly
hooks such as `useTodos` / `useTodo` / `useCreateTodo`). Do not edit that file.
Custom collections call `createCollectionHooks` in a sibling file. Names are chosen
so they do not collide with RTK `openApiSdk.ts` during dual-stack migration.

```bash
# Backend running on port 4000
cd example-frontend && bun run sync-sdk
```

### Does `bun run sdk` still work?

**Yes.** `example-frontend/package.json` still defines:

```json
"sdk": "bun scripts/generate-sdk.ts && bun biome check --write scripts/generate-sdk.ts"
```

It runs `@rtk-query/codegen-openapi` against `openapi-config.ts` and writes `store/openApiSdk.ts`.

### What changes post-migration

| Still generated | Stop using for migrated collections |
|-----------------|-------------------------------------|
| Auth routes, `GET /auth/me`, admin, AI explorer, version config, feature flags | Collection CRUD — import from `store/syncDbSdk.ts` instead |
| Custom REST / RPC endpoints | Todo `realtimeList` / `realtimeDocument` wiring in `store/sdk.ts` |

Keep running `bun run sdk` after backend route changes — non-synced screens still import from `store/sdk.ts`.

Workflow:

```bash
# Backend running on port 4000
cd example-frontend && bun run sdk
cd example-frontend && bun run sync-sdk
```

### Syncdb hooks codegen

For collections with `sync` enabled on the backend, generate local-first hooks from the same OpenAPI spec:

```bash
cd example-frontend && bun run sync-sdk
```

This writes `store/syncDbSdk.ts` with friendly hooks (`useTodos`, `useCreateTodo`, …) that intentionally differ from RTK names so both SDKs can coexist during migration. Import synced screens from `@/store/syncDbSdk`, not `store/sdk.ts`.

## 9. Feature flags

Post-migration, feature flags stay on `@terreno/rtk` + OpenFeature — **not** on syncdb.

**After** (`example-frontend/app/_layout.tsx`):

```typescript
import {OpenFeatureProvider} from "@openfeature/react-sdk";
import {useTerrenoFeatureFlags} from "@terreno/rtk";

const OpenFeatureBridge = ({children, socket}) => {
  const bridgeUserId = useSelector(selectBetterAuthUserId) ?? undefined;
  useTerrenoFeatureFlags(terrenoApi, {skip: !bridgeUserId, socket, userId: bridgeUserId});
  return <OpenFeatureProvider domain="feature-flags">{children}</OpenFeatureProvider>;
};
```

See [`docs/reference/feature-flags.md`](../reference/feature-flags.md) and [`docs/how-to/add-feature-flags.md`](add-feature-flags.md).

**Example app gap:** todos do **not** gate on a feature flag — `SyncTodosScreen` is syncdb-only. For a gradual rollout, add a boolean flag and render the RTK screen when off, syncdb screen when on (see §10). The reference migration intentionally skipped flag wiring to keep one data path for e2e tests.

## 10. Rollback

### Per-screen feature flag

Ship both implementations behind a flag:

- Flag **off** → legacy RTK Query screen
- Flag **on** → syncdb screen

Both bundles ship until you flip the default and delete the RTK path.

The example app does **not** use this pattern for todos.

### What local data survives

| Event | Local IndexedDB / SQLite | Outbox |
|-------|------------------------|--------|
| Logout / 401 | **Kept** (INV-2) | **Kept** — same user can sign back in and replay |
| Different-user login | **Wiped** | **Wiped** |
| `signOut()` default | **Kept** | **Kept** |
| `signOut()` with `wipeOnSignOut: true` | **Wiped** | **Wiped** |
| Schema version mismatch | **Wiped** + re-bootstrap | Re-built |
| Decrypt failure (web, default) | **Wiped** + re-bootstrap | Re-built |

`wipeLocalData` clears store tables, persisted databases, and cached encryption keys (`syncdb/src/storage/wipe.ts`).

Rolling back a **screen** to RTK does not automatically clear syncdb data — stale local todos may still exist until user switch or explicit wipe. Plan for that if you flip the flag off in production.

## 11. Checklist

Copy and track per collection:

```
[ ] 1. Backend: isDeletedPlugin + syncPlugin on schema
[ ] 2. Backend: modelRouter sync scope configured
[ ] 3. Backend: SyncApp + RealtimeApp registered; Mongo replica set running
[ ] 4. Backend: ensureSyncIndexes succeeds at startup
[ ] 5. Frontend: @terreno/syncdb installed; expo-sqlite in app (native)
[ ] 6. Frontend: createSyncDb client + betterAuthAdapter
[ ] 7. Frontend: syncDb.start()/stop() wired to auth in root layout
[ ] 8. Frontend: SyncDbProvider wraps migrated screens
[ ] 9. Reads: useGet*Query → useQuery / useEntityIds + useEntity
[ ] 10. Writes: usePost/Patch/Delete*Mutation → useMutate().create/update/remove
[ ] 11. Deleted RTK: mutation isLoading spinners, refetch-after-mutate, offline middleware entries, realtime cache patches
[ ] 12. Conflicts: useConflicts + resolution UI (ConflictSheet or equivalent)
[ ] 13. Sync status: useSyncStatus + SyncStatusBanner / health toasts (not query isLoading)
[ ] 14. Auth: Better Auth session + onAuthRequired → re-login when paused
[ ] 15. Codegen: bun run sdk still run for non-synced routes; remove todo hooks from screens
[ ] 16. Feature flags: OpenFeature bridge still fed via useTerrenoFeatureFlags (if used)
[ ] 17. Rollback plan: feature flag or accept stale local data on revert
[ ] 18. Verify: CRUD, offline create/edit/delete, reconnect, conflict both strategies, user switch
```

## Backend prerequisites (detail)

Before a collection can sync:

- [ ] `isDeletedPlugin` on schema (soft delete required)
- [ ] `syncPlugin` on schema (`_syncSeq` stamping)
- [ ] `modelRouter("/path", Model, {sync: {scope: ...}})` three-argument form
- [ ] Custom scopes include `snapshotFilter`
- [ ] `new SyncApp({getUserScopes?})` for tenant/custom scopes
- [ ] `new RealtimeApp({betterAuth?})` + MongoDB replica set
- [ ] No `updateMany`, `deleteMany`, `deleteOne`, `findOneAndDelete`, or `bulkWrite` on synced models

## What stays on @terreno/rtk

- Generated OpenAPI SDK for non-synced routes
- Better Auth Redux slice (`generateBetterAuthSlice`)
- Feature flags (`useTerrenoFeatureFlags` / `useFeatureFlags`)
- Socket connection for flags and legacy realtime (until removed)
- `@terreno/rtk` is not being removed

## Further reading

- [`docs/reference/syncdb.md`](../reference/syncdb.md) — full API reference
- [`syncdb/README.md`](https://github.com/TerrenoLabs/terreno/blob/release-56.0.0/syncdb/README.md) — architecture and protocol detail
- [`docs/how-to/configure-better-auth.md`](configure-better-auth.md) — Better Auth setup
