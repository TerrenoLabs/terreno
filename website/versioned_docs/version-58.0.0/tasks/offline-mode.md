# Task List: Offline Mode

**Status:** Closed (2026-08-20) — IP deferred; superseded by `@terreno/syncdb`. Open tasks below will not be executed.

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

## Phase 1: RTK Core Offline Framework

- [ ] **Task 1.1**: Formalize offline state and queue record types
  - Description: Extend the offline slice state to represent connection quality, auth-blocked replay, queue record statuses, base timestamps, optimistic/server IDs, and persisted queue versioning. Keep the slice default inert until offline mode is mounted by a consuming app.
  - Files: `rtk/src/offlineSlice.ts`, `rtk/src/useOfflineStatus.ts`, `rtk/src/index.ts`, related `rtk/src/*.test.ts`
  - Depends on: none
  - Acceptance: Unit tests cover enqueue/dequeue/status transitions, conflict storage, auth-blocked state, queue version defaults, and selectors for `online`, `spotty`, `offline`, queued mutations, conflicts, and replay-paused state.

- [ ] **Task 1.2**: Replace endpoint-name-only offline gating with modelRouter config
  - Description: Introduce a typed `OfflineModelRouterConfig` that maps model names and modelRouter operations to generated RTK Query endpoint names. Preserve a migration path for existing endpoint-name configuration only if it is already shipped behavior; otherwise replace it with the modelRouter config.
  - Files: `rtk/src/offlineGate.ts`, `rtk/src/offlineMiddleware.ts`, `rtk/src/index.ts`, `rtk/src/offlineGate.test.ts`
  - Depends on: Task 1.1
  - Acceptance: Tests prove disabled/default config never defers mutations, enabled modelRouter endpoints are deferred while offline, unconfigured custom routes are not deferred, and array operations can be configured separately from create/update/delete.

- [ ] **Task 1.3**: Add optimistic create ID strategy
  - Description: Add default ObjectId-compatible ID generation for optimistic modelRouter creates, inject the generated ID into the configured request field, and support per-model overrides for `generateId`, request field, and server ID reconciliation strategy.
  - Files: `rtk/src/offlineMiddleware.ts`, `rtk/src/offlineGate.ts`, `rtk/src/offlineIds.ts` (new if useful), `rtk/src/index.ts`, related tests
  - Depends on: Task 1.2
  - Acceptance: Tests verify default IDs are stable and ObjectId-shaped, custom generators are used, optimistic create cache entries use the same local ID as the queued mutation, and a server-returned replacement ID can be mapped when explicitly configured.

- [ ] **Task 1.4**: Harden optimistic cache update strategies
  - Description: Make optimistic cache updates explicit per modelRouter operation while providing safe defaults for create, update, delete, array push, array update, and array remove. Expose an override hook so app teams can customize cache updates for complex list filters or response shapes.
  - Files: `rtk/src/offlineMiddleware.ts`, `rtk/src/offlineOptimistic.ts` (new if useful), `rtk/src/useOfflineStatus.ts`, related tests
  - Depends on: Task 1.3
  - Acceptance: Tests cover optimistic insert, patch, remove, and array mutations against RTK Query cache entries, including rollback or conflict marking when replay fails with a non-network/non-auth error.

- [ ] **Task 1.5**: Pause replay on auth refresh failure without clearing cache
  - Description: Separate token-refresh failure from explicit logout. If refresh cannot complete because the server/network is unavailable or refresh returns a retryable failure, mark replay as auth-blocked and keep RTK Query cache, queue, conflicts, and optimistic records intact. Reserve destructive cleanup for the actual logout action.
  - Files: `rtk/src/emptyApi.ts`, `rtk/src/authSlice.ts`, `rtk/src/offlineMiddleware.ts`, `rtk/src/offlineSlice.ts`, related tests
  - Depends on: Task 1.1
  - Acceptance: Tests simulate expired access tokens with unreachable refresh endpoint and verify queued mutations are held, cache data remains, and replay resumes after auth is refreshed; explicit logout still clears tokens and configured offline/cache state.

- [ ] **Task 1.6**: Implement keep-mine and use-server conflict resolution
  - Description: Add conflict resolution actions/helpers. `useServer` should discard the queued mutation and patch cache to the server value. `keepMine` should update the queued mutation with the latest server timestamp, reapply the local optimistic value, and retry replay with fresh precondition headers.
  - Files: `rtk/src/offlineSlice.ts`, `rtk/src/offlineMiddleware.ts`, `rtk/src/useOfflineStatus.ts`, `rtk/src/index.ts`, related tests
  - Depends on: Task 1.4
  - Acceptance: Tests cover `409 Conflict` replay responses, stored local/server values, resolving with `useServer`, resolving with `keepMine`, and preventing duplicate conflict records for the same queued mutation.

## Phase 2: Connection Quality and UI

- [ ] **Task 2.1**: Upgrade server status monitoring to connection quality
  - Description: Extend `useServerStatus` to compute `online`, `spotty`, and `offline` from browser/native reachability events, health-check failures, latency, and recent failure rate. Make health URL, interval, timeout, latency threshold, failure count, and failure-rate thresholds configurable.
  - Files: `rtk/src/useServerStatus.ts`, `rtk/src/offlineSlice.ts`, `rtk/src/index.ts`, related tests
  - Depends on: Task 1.1
  - Acceptance: Tests cover all three connection states, threshold overrides, transition from spotty back to online, transition to offline after configured consecutive failures, and no polling when status monitoring is disabled.

- [ ] **Task 2.2**: Expose richer offline status hooks
  - Description: Expand `useOfflineStatus` to return connection quality, queue length, syncing state, auth-blocked state, conflicts, local-only helpers, and conflict resolution callbacks while preserving low-level selectors for custom UI.
  - Files: `rtk/src/useOfflineStatus.ts`, `rtk/src/offlineSlice.ts`, `rtk/src/index.ts`, related tests
  - Depends on: Task 1.6, Task 2.1
  - Acceptance: Hook tests or focused unit tests verify returned state and callbacks for queued, syncing, auth-blocked, conflicted, local-only, and healthy states.

- [ ] **Task 2.3**: Update offline banner for online, spotty, offline, syncing, and auth-blocked states
  - Description: Evolve `OfflineBanner` so apps can show offline, spotty connection, syncing queued changes, pending changes, and auth-blocked sync messaging. Keep props simple enough for custom state sources.
  - Files: `ui/src/OfflineBanner.tsx`, `ui/src/index.tsx`, `ui/src/OfflineBanner.test.tsx` (new if absent), `demo/stories/OfflineBanner.stories.tsx` (new or update)
  - Depends on: Task 2.1
  - Acceptance: UI tests or stories cover hidden/online, spotty, offline, syncing, pending queue, and auth-blocked variants with clear copy and accessible test IDs.

- [ ] **Task 2.4**: Add conflict resolution UI components
  - Description: Add reusable conflict UI that renders unresolved conflicts and lets users choose "Keep mine" or "Use server". Keep it generic by accepting display renderers for local and server values.
  - Files: `ui/src/OfflineConflictList.tsx` (new), `ui/src/OfflineConflictCard.tsx` (new), `ui/src/index.tsx`, `ui/src/*.test.tsx`, `demo/stories/OfflineConflict*.stories.tsx`
  - Depends on: Task 2.2
  - Acceptance: Tests or stories cover no-conflict, single-conflict, multiple-conflict, keep-mine click, use-server click, dismissed/resolved conflict filtering, and custom value rendering.

## Phase 3: modelRouter Backend Contract

- [ ] **Task 3.1**: Verify client-provided modelRouter create IDs
  - Description: Add backend tests that prove modelRouter create accepts a client-provided ObjectId-compatible `_id` when the schema allows it and rejects invalid IDs through existing validation/error handling.
  - Files: `api/src/api.ts`, `api/src/tests/*.test.ts` or existing modelRouter test file, `api/src/tests.ts`
  - Depends on: Task 1.3
  - Acceptance: API tests pass for create with client `_id`, returned document keeps that `_id`, duplicate IDs fail safely, and invalid IDs return a clear validation/error response.

- [ ] **Task 3.2**: Formalize conflict response tests for modelRouter updates
  - Description: Add/extend modelRouter tests for `If-Unmodified-Since` and `X-Unmodified-Since-ISO` headers to guarantee stale updates return `409 Conflict` with the current server document and fresh updates succeed.
  - Files: `api/src/api.ts`, `api/src/tests/*.test.ts` or existing modelRouter test file
  - Depends on: none
  - Acceptance: API tests cover conflict by HTTP-date header, conflict by ISO header, success with current timestamp, missing timestamp behavior, and response body shape consumed by `@terreno/rtk`.

- [ ] **Task 3.3**: Document the modelRouter offline contract
  - Description: Add docs for modelRouter offline compatibility: supported CRUD/array endpoints, client-provided IDs, conflict headers, expected `409` response shape, permissions behavior, and explicit non-support for custom sync endpoints in v1.
  - Files: `api/README.md` or package docs, `rtk/README.md` or package docs, `docs/implementationPlans/offline-mode.md`
  - Depends on: Task 3.1, Task 3.2
  - Acceptance: Docs show a modelRouter route configuration and matching frontend offline config, and clearly state that custom route sync is future work.

## Phase 4: Example App Integration

- [ ] **Task 4.1**: Enable offline mode for example todos
  - Description: Wire the example frontend store to mount the offline reducer, persist the offline slice, configure todos modelRouter endpoints for offline create/update/delete, and keep API cache persistence consistent with the offline plan.
  - Files: `example-frontend/store/index.ts`, `example-frontend/store/sdk.ts`, `example-frontend/app/_layout.tsx`, `example-frontend/package.json` if scripts need updates
  - Depends on: Task 1.6, Task 2.2
  - Acceptance: Example app can create, update, and delete todos while offline; queued todos survive app reload when persistence is enabled; replay syncs after the backend is reachable again.

- [ ] **Task 4.2**: Integrate connection banner and sync state in the example app
  - Description: Add root-level status monitoring and display `OfflineBanner` for offline, spotty, syncing, pending queue, and auth-blocked states. Ensure copy is visible without disrupting auth navigation.
  - Files: `example-frontend/app/_layout.tsx`, `example-frontend/app/(tabs)/_layout.tsx`, `example-frontend/app/(tabs)/index.tsx`
  - Depends on: Task 2.3, Task 4.1
  - Acceptance: Manual test can trigger offline/spotty/syncing/auth-blocked states and see the correct banner copy and pending queue count.

- [ ] **Task 4.3**: Add example conflict resolution flow
  - Description: Show unresolved todo conflicts in the example app and wire "Keep mine" / "Use server" actions to the RTK conflict resolution helpers.
  - Files: `example-frontend/app/(tabs)/index.tsx`, `example-frontend/components/*` if a local wrapper is useful
  - Depends on: Task 2.4, Task 4.1
  - Acceptance: Manual test can create a stale update conflict, see local/server values, choose "Use server" to accept server state, and choose "Keep mine" to replay local state.

- [ ] **Task 4.4**: Add example backend support tests or fixtures for offline scenarios
  - Description: Ensure the example backend todo model and route can support client IDs and conflict timestamps. Add tests or fixtures that make the example integration verifiable without modifying generated SDK files manually.
  - Files: `example-backend/src/models/todo.ts`, `example-backend/src/api/todos.ts`, `example-backend/src/**/*.test.ts`
  - Depends on: Task 3.1, Task 3.2
  - Acceptance: Example backend tests pass and confirm todos work with the modelRouter offline contract.

## Phase 5: Verification, Documentation, and Release Readiness

- [ ] **Task 5.1**: Add package-level offline mode docs
  - Description: Write consumer documentation for enabling offline mode, configuring modelRouter endpoints, selecting ID strategy, configuring connection quality, handling auth-blocked replay, and rendering conflict UI.
  - Files: `rtk/README.md`, `ui/README.md` if present, `docs/implementationPlans/offline-mode.md`
  - Depends on: Task 1.6, Task 2.4, Task 3.3
  - Acceptance: Docs include copy-pasteable store setup, model config, status hook usage, `OfflineBanner`, and conflict resolution examples.

- [ ] **Task 5.2**: Add end-to-end manual verification guide
  - Description: Document the exact local steps to verify offline create/update/delete, replay, auth-blocked behavior, spotty status, and conflict resolution using example backend and frontend.
  - Files: `docs/offline-mode-verification.md` (new) or relevant docs directory, `docs/implementationPlans/offline-mode.md`
  - Depends on: Task 4.3
  - Acceptance: Guide lists setup commands, offline simulation steps, expected UI states, and cleanup steps; it does not require editing generated SDK files manually.

- [ ] **Task 5.3**: Run focused validation suite
  - Description: Run and fix failures for the focused packages touched by offline mode.
  - Files: no source changes expected unless validation finds failures
  - Depends on: Task 5.1, Task 5.2
  - Acceptance: `bun run rtk:compile` or equivalent package compile passes, `bun run ui:test` passes for new UI tests, `bun run api:test` passes for modelRouter tests, and example package checks used by the repo pass or have documented blockers.

- [ ] **Task 5.4**: Regenerate SDK only if backend API surface changes
  - Description: If implementation changes OpenAPI output for modelRouter conflict responses or example backend route schemas, regenerate `example-frontend/store/openApiSdk.ts` using the SDK generation workflow. If no OpenAPI surface changed, explicitly skip this task in the implementation PR notes.
  - Files: `example-frontend/store/openApiSdk.ts`, `example-frontend/openapi-config.ts`
  - Depends on: Task 3.3, Task 4.4
  - Acceptance: Generated SDK is updated only from the backend OpenAPI spec and never edited manually; PR notes state whether SDK regeneration was required.
