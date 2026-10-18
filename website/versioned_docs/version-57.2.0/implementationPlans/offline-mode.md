# Implementation Plan: Offline Mode

**Status:** Deferred
**Closed:** 2026-08-20 — Superseded by [@terreno/syncdb](syncdb-local-first.md) local-first outbox and offline-capable sync.
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1096
**Priority:** High
**Effort:** Medium

## Context

Terreno already has offline primitives in `@terreno/rtk`, including `offlineSlice`, `offlineMiddleware`, `offlineGate`, `useOfflineStatus`, and `useServerStatus`. The offline-mode plan should harden those primitives into an opt-in offline-first framework that starts with generated `modelRouter` CRUD endpoints, keeps local data through token refresh failures, and gives app teams reusable UI without blocking custom sync logic later.

## Core Concept

Offline mode v1 is a configurable client-side sync layer for modelRouter endpoints. Apps opt in per model/endpoint, RTK Query caches receive optimistic updates, mutations are queued in persisted Redux state while offline or auth-blocked, and queued work replays when connection and auth are healthy.

The backend remains the existing modelRouter API. Backend work is limited to formalizing two modelRouter capabilities that are already present or aligned with Mongoose:

- optimistic create with client-provided ObjectId-compatible `_id` values,
- update conflict detection with `If-Unmodified-Since` / `X-Unmodified-Since-ISO` and a `409 Conflict` server document response.

## Models

No new server-side Mongoose models are required for v1. Offline queue and conflict records are local client state in `@terreno/rtk` and should be persisted through the consuming app's Redux persistence configuration.

### Client state: offline slice

```typescript
interface OfflineState {
  connectionQuality: "online" | "spotty" | "offline";
  queue: QueuedMutation[];
  conflicts: ConflictRecord[];
  isSyncing: boolean;
  isReplayPausedForAuth: boolean;
  lastHealthCheck?: HealthCheckSnapshot;
}

interface QueuedMutation {
  id: string;
  endpointName: string;
  modelName: string;
  operation: "create" | "update" | "delete" | "arrayPush" | "arrayUpdate" | "arrayRemove";
  args: unknown;
  body?: Record<string, unknown>;
  optimisticId?: string;
  serverId?: string;
  idempotencyKey: string;
  createdAt: string;
  lastAttemptAt?: string;
  attemptCount: number;
  baseUpdatedAt?: string;
  status: "queued" | "replaying" | "authBlocked" | "conflicted" | "failed";
  error?: string;
}

interface ConflictRecord {
  id: string;
  queueId: string;
  endpointName: string;
  modelName: string;
  operation: "update" | "delete" | "arrayUpdate" | "arrayRemove";
  localArgs: unknown;
  localBody?: Record<string, unknown>;
  serverValue: unknown;
  baseUpdatedAt?: string;
  serverUpdatedAt?: string;
  dismissed: boolean;
  createdAt: string;
}

interface HealthCheckSnapshot {
  checkedAt: string;
  latencyMs?: number;
  consecutiveFailures: number;
  recentFailureRate: number;
}
```

### Configuration model

```typescript
interface OfflineModelRouterConfig {
  enabled: boolean;
  models: OfflineModelConfig[];
  connectionQuality?: ConnectionQualityConfig;
  auth?: OfflineAuthConfig;
}

interface OfflineModelConfig {
  modelName: string;
  tagType: string;
  endpoints: {
    create?: OfflineEndpointConfig;
    update?: OfflineEndpointConfig;
    delete?: OfflineEndpointConfig;
    arrayPush?: OfflineEndpointConfig;
    arrayUpdate?: OfflineEndpointConfig;
    arrayRemove?: OfflineEndpointConfig;
  };
  idStrategy?: OfflineIdStrategy;
  conflictStrategy?: "manual" | "keepMine" | "useServer";
}

interface OfflineEndpointConfig {
  endpointName: string;
  enabled?: boolean;
  optimisticUpdate?: OfflineOptimisticUpdate;
}

interface OfflineIdStrategy {
  generateId?: () => string;
  requestField?: string;
  reconcile?: "assumeClientId" | "mapServerId";
}

interface ConnectionQualityConfig {
  healthUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  spottyLatencyMs?: number;
  offlineFailureCount?: number;
  spottyFailureRate?: number;
}

interface OfflineAuthConfig {
  pauseReplayWhileRefreshing?: boolean;
  pauseReplayOnRefreshFailure?: boolean;
  clearCacheOnLogoutOnly?: boolean;
}
```

### ID strategy

Default behavior:

- generate an ObjectId-compatible string for optimistic creates,
- send it as `_id` in the modelRouter create body,
- assume the server returns the same ID,
- keep cache keys stable from optimistic create through replay confirmation.

Overrides:

- apps can provide `generateId`,
- apps can choose another request field,
- apps can reconcile a server-returned ID if the backend does not preserve the client ID.

## APIs

### Server API surface

No custom sync endpoints for v1. Offline mode targets standard modelRouter endpoints only:

| Method | Path | modelRouter operation | Offline behavior |
| --- | --- | --- | --- |
| `POST` | `/{resource}` | create | Queue and optimistically insert a local item when offline or spotty; default `_id` comes from client ID strategy. |
| `PATCH` | `/{resource}/:id` | update | Queue and optimistically patch cache; replay with `If-Unmodified-Since` / `X-Unmodified-Since-ISO` when a base timestamp is known. |
| `DELETE` | `/{resource}/:id` | delete | Queue and optimistically remove/mark local item based on app strategy. |
| `POST` | `/{resource}/:id/:field` | array push | Queue and optimistically append item to cached field. |
| `PATCH` | `/{resource}/:id/:field/:itemId` | array update | Queue and optimistically patch array item. |
| `DELETE` | `/{resource}/:id/:field/:itemId` | array remove | Queue and optimistically remove array item. |

### Backend requirements

- modelRouter create should accept client-provided ObjectId-compatible `_id` values when the schema allows them.
- modelRouter update should keep returning `409 Conflict` when precondition headers are older than the current server `updated` timestamp.
- The conflict response should include the current server document in a stable response field.
- No server-side queue, sync cursor, or batch replay endpoint is included in v1.

### Client API surface

```typescript
const offlineMiddleware = createOfflineMiddleware({
  api,
  offline: {
    enabled: true,
    models: [
      {
        modelName: "Todo",
        tagType: "todos",
        endpoints: {
          create: {endpointName: "postTodos"},
          update: {endpointName: "patchTodosById"},
          delete: {endpointName: "deleteTodosById"},
        },
      },
    ],
  },
});
```

New or hardened exports from `@terreno/rtk`:

- `createOfflineMiddleware(options)` - opt-in middleware with modelRouter config.
- `offlineReducer` - persisted local queue/conflict state.
- `useOfflineStatus()` - queue, sync, conflict, and auth-blocked state.
- `useServerStatus(config)` - computes `online`, `spotty`, or `offline`.
- `resolveConflict({conflictId, resolution})` - supports `resolution: "keepMine" | "useServer"`.
- `selectConnectionQuality`, `selectQueuedMutations`, `selectConflicts`.

### Auth behavior

- Token refresh attempts continue using the existing mutex in `emptyApi`.
- If refresh cannot complete because the network/server is unavailable, replay pauses and queued mutations move to `authBlocked` instead of failing permanently.
- Cached RTK Query data, queued mutations, conflicts, and optimistic local records remain intact.
- Cache/queue clearing only happens after an explicit logout action.

### Conflict resolution behavior

`useServer`:

- remove the queued mutation,
- patch the RTK Query cache with the server document,
- mark the conflict resolved/dismissed.

`keepMine`:

- update the queued mutation's `baseUpdatedAt` to the server `updated` timestamp,
- keep or reapply the local optimistic cache patch,
- replay the mutation again with the new precondition headers.

## Notifications

No push, email, or SMS notifications are required for v1.

In-app notifications:

- offline/spotty/syncing banner,
- pending mutation count,
- auth-blocked sync message when replay needs re-auth,
- conflict notification with actions for "keep mine" and "use server".

## UI

Reusable `@terreno/ui` components and hooks:

- `OfflineBanner` evolves to render `online`, `spotty`, `offline`, `syncing`, and `authBlocked` states.
- `OfflineConflictList` renders unresolved conflicts.
- `OfflineConflictCard` shows local/server values and resolution buttons.
- `useOfflineStatus` remains the low-level hook for custom app UI.
- Example frontend wires the status monitor and banner at the root layout and shows conflicts on the todos screen.

## Feature Flags & Migrations

- Offline mode is default off.
- Apps enable it in store setup by mounting `offlineReducer` and adding `createOfflineMiddleware`.
- Existing consumers are unaffected unless they opt in.
- Queue persistence should include a version number so future changes can migrate or discard incompatible queue records safely.
- No backend data migration is required.

## Activity Log & User Updates

No new activity log system is required for v1. Replayed modelRouter mutations should behave like normal API mutations on the backend. A future version can add audit metadata such as `X-Terreno-Offline-Replay` if consuming apps need to distinguish offline-originated changes.

## Phases

1. **RTK core hardening**
   - Formalize modelRouter endpoint config.
   - Add create ID strategy defaults and overrides.
   - Add auth-blocked replay state.
   - Add conflict resolution actions.
   - Add queue persistence versioning.

2. **Connection status and UI**
   - Upgrade `useServerStatus` to emit `online`, `spotty`, and `offline`.
   - Update `OfflineBanner`.
   - Add conflict resolution UI components.

3. **Backend formalization and tests**
   - Add/verify modelRouter tests for client-provided IDs.
   - Add/verify conflict response contract tests.
   - Document modelRouter offline requirements.

4. **Example app integration and docs**
   - Configure todos for offline mode.
   - Demonstrate optimistic create/update/delete.
   - Demonstrate offline, spotty, auth-blocked, and conflict states.

## Not Included / Future Work

- Custom route sync strategies.
- Server-side mutation queues.
- Batch sync/cursor endpoints.
- Background sync while the app is closed.
- Binary/file upload offline queues.
- Multi-user collaborative merge UI beyond "keep mine" / "use server".
- Local relational database adapters.

## Risks & Mitigations

- **Generic optimistic updates can become too magical:** Keep modelRouter defaults simple and expose per-endpoint custom optimistic update functions.
- **Create ID reconciliation can break cache keys:** Default to client-provided ObjectId values and only support server ID remapping through an explicit strategy.
- **Auth refresh failures can look like logout:** Introduce a separate auth-blocked replay state and reserve destructive clearing for explicit logout.
- **Spotty detection can be noisy:** Make thresholds configurable and expose raw health metrics for app tuning.
- **Conflict UI can balloon:** Limit v1 to "keep mine" and "use server"; defer field-level merge tooling.

## Acceptance Criteria

- Offline mode is opt-in and disabled by default.
- A modelRouter-backed model can opt into offline create/update/delete through `@terreno/rtk` configuration.
- Offline create uses a stable default client ID and supports a custom ID strategy.
- Queued mutations persist through app reload when the consuming app persists the offline slice.
- Failed token refresh pauses replay without clearing RTK Query cache or queued mutations.
- Explicit logout clears auth and configured offline/cache state.
- Conflicts from modelRouter `409` responses can be resolved with "keep mine" or "use server".
- Connection status can represent `online`, `spotty`, and `offline` with configurable thresholds.
- Reusable UI surfaces show offline/spotty/syncing/auth-blocked/conflict states.
- Example frontend demonstrates offline todos with optimistic create/update/delete and conflict resolution.

---

## Approval Notes

The modelRouter-only client/API foundation has been approved. Implementation tasks live in `docs/tasks/offline-mode.md`.
