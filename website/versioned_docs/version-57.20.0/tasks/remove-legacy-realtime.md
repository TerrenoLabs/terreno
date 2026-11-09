# Task List: Remove legacy RTK realtime in Terreno 58

See: [`docs/implementationPlans/remove-legacy-realtime.md`](../implementationPlans/remove-legacy-realtime.md)

**Target:** Terreno **58.0.0**. Do not execute Phase 2 on the 57.x line.

`RealtimeApp` is **not** in this deletion. It remains the Socket.io / change-stream host for `@terreno/syncdb`.

## Phase 1: Deprecate on 57.x (current)

- [x] **Task 1.1**: Runtime and JSDoc deprecation for `modelRouter` `realtime`
  - Delivers: one-time `logger.warn` per model/path; `@deprecated` on `ModelRouterOptions.realtime`, `RealtimeConfig`, and `RealtimeEvent`
  - Files: `api/src/realtime/deprecation.ts`, `api/src/api.ts`, `api/src/realtime/types.ts`, `api/src/realtime/deprecation.test.ts`
  - Blocked by: none
  - Acceptance: tests prove one warning per model/path; message names Terreno 58 and `@terreno/syncdb`

- [x] **Task 1.2**: Runtime and JSDoc deprecation for RTK cache-patching helpers
  - Delivers: one-time `console.warn`; `@deprecated` on `realtimeList`, `realtimeDocument`, `setRealtimeSocket`, `getRealtimeSocket`, `RealtimeEvent`
  - Files: `rtk/src/realtime.ts`, `rtk/src/realtime.test.ts`
  - Blocked by: none
  - Acceptance: tests prove a single warning across the three helpers; message names Terreno 58 and `@terreno/syncdb`

- [x] **Task 1.3**: Docs, changelog, and agent skills
  - Delivers: consumers can find the sunset date and replacement without reading source
  - Files: `docs/reference/api.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/reference/legacy/rtk.md`, `changelog/unreleased/`, `.rulesync/skills/`
  - Blocked by: Task 1.1, Task 1.2
  - Acceptance: docs say `RealtimeApp` stays; `modelRouter` `realtime` and RTK helpers go away in 58

## Phase 2: Delete in Terreno 58

- [ ] **Task 2.1**: Remove `modelRouter` `realtime` registration
  - Delivers: passing `realtime` is a type error; no `registerRealtime` from `modelRouter`
  - Files: `api/src/api.ts`, `api/src/realtime/types.ts`, `api/src/realtime/deprecation.ts`, `api/src/index.ts`, `api/src/api.test.ts`
  - Blocked by: Terreno 58 major
  - Acceptance: TypeScript and tests fail if a router still passes `realtime`; `sync` registration is unchanged

- [ ] **Task 2.2**: Stop emitting legacy `sync` (RTK) websocket events
  - Delivers: change streams emit `sync:delta` only for synced models; no RTK `sync` payload
  - Files: `api/src/realtime/changeStreamWatcher.ts`, `api/src/realtime/realtimeApp.ts`, `api/src/realtime/registry.ts`, related tests
  - Blocked by: Task 2.1
  - Acceptance: a model with only `sync` still emits `sync:delta`; no `sync` events for collection CRUD; `admin:model.changed` still works when `admin.realtime` is true

- [ ] **Task 2.3**: Remove `@terreno/rtk` cache-patching helpers
  - Delivers: `realtimeList`, `realtimeDocument`, `setRealtimeSocket`, `getRealtimeSocket` are gone from the package
  - Files: `rtk/src/realtime.ts`, `rtk/src/realtime.test.ts`, `rtk/src/index.ts`, `rtk/README.md`
  - Blocked by: Task 2.1
  - Acceptance: package compile fails if those symbols are imported; `useSocketConnection` still exists

- [ ] **Task 2.4**: Remove example and bootstrap usage
  - Delivers: example-backend/example-frontend/MCP bootstrap do not configure RTK realtime
  - Files: `example-backend/src/api/todos.ts`, `example-frontend/store/sdk.ts`, `example-frontend/app/_layout.tsx`, MCP bootstrap templates
  - Blocked by: Task 2.3
  - Acceptance: todos stay on `sync` + syncdb; `setRealtimeSocket` / `realtimeList` / `realtimeDocument` are gone; `RealtimeApp` remains registered

- [ ] **Task 2.5**: Docs, skills, changelog, 58.0.0 upgrade note
  - Delivers: upgrade note lists every removed symbol and the syncdb replacement
  - Files: `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/reference/api.md`, `.rulesync/skills/terreno-data-fetching/references/realtime.md`, `.rulesync/skills/terreno-backend-api/references/model-router.md`, `mcp-server/src/docs/upgrades/58.0.0.md`, changelog
  - Blocked by: Task 2.4
  - Acceptance: `bun run check:changelog` passes for 58.0.0; upgrade note exists; no skill tells agents to set `modelRouter` `realtime` for collection CRUD
