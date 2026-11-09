# Tasks: Migrate built-in admin to syncdb

IP: [migrate-admin-to-syncdb.md](../implementationPlans/migrate-admin-to-syncdb.md)

**Status:** Approved. Pick–Roast execution is in progress.

Skills for Pick: `terreno-data-fetching`, `terreno-backend-api`, `mongoose-schema-safety` (only if a later task touches schema — this IP must not), `generate-sdk` (only if OpenAPI for non-admin routes changes), `verify-ui-changes`, `update-docs`, `backend-test-env`, `terreno-ui`, `update-agent-docs`.

---

## Phase 1 — Characterization + CI (no product behavior)

Phase 1 is a hard gate. Protocol and UI tasks stay blocked until every Phase 1 checkbox is done.

- [x] **Task 1.1**: `admin-frontend` ≥95% line+function coverage + threshold
  - Delivers: existing screens/hooks covered enough that `bun test` in `admin-frontend` meets 95% lines and functions; `bunfig.toml` `coverageThreshold` set so CI fails on drop
  - Files: `admin-frontend/src/**/*.test.*`, `admin-frontend/bunfig.toml`
  - Blocked by: none
  - Acceptance: `cd admin-frontend && bun test --coverage` reports ≥95% lines and functions; threshold is committed

- [x] **Task 1.2**: `admin-backend` coverage scope excludes `@terreno/test` dist
  - Delivers: LCOV / bun coverage for the package measures `admin-backend/src` (and dist of this package only), not `../test/dist/**`; package still ≥95% on that scope
  - Files: `admin-backend/bunfig.toml` (or coverage ignore), related test config
  - Blocked by: none
  - Acceptance: coverage report no longer attributes `@terreno/test` files; `adminApp.ts` and package source still ≥95%; `cd admin-backend && bun test --coverage` green

- [x] **Task 1.3**: CircleCI jobs for admin packages
  - Delivers: `admin-backend-ci` and `admin-frontend-ci` in continue-config; root script `admin-frontend:test`; both jobs in the required workflow
  - Files: `.circleci/continue-config.yml`, `package.json`
  - Blocked by: 1.1, 1.2
  - Acceptance: config YAML lists both jobs; `bun run admin-frontend:test` and `bun run admin-backend:test` work from repo root

- [x] **Task 1.4**: Shard existing admin Playwright specs into CI
  - Delivers: `example-frontend/e2e/admin-home.spec.ts`, `admin-form.spec.ts`, `admin-table-search-filter.spec.ts`, `admin-table-bulk-actions.spec.ts`, `admin-custom-screens.spec.ts`, `admin-comms-back.spec.ts` (and siblings that exist) run in the CircleCI Playwright matrix, not only `admin.spec.ts`
  - Files: `.circleci/continue-config.yml`, any e2e project config
  - Blocked by: none
  - Acceptance: continue-config matrix includes those spec files; a dry read of the YAML shows them next to `admin.spec.ts`

- [x] **Task 1.5**: Golden HTTP tests for admin membership + config
  - Delivers: pinned assertions for `GET /admin/config` shape and list/search/bulk-patch on a synced String `_id` model (example Todo) plus an ObjectId model (User) so later protocol work cannot silently change REST
  - Files: `admin-backend/src/adminApp*.test.ts` (or new focused spec)
  - Blocked by: none
  - Acceptance: tests fail if list query params, pagination envelope, or bulk-patch URL/body change; `bun test` in admin-backend passes

- [x] **Task 1.6**: Pin `useAdminApi` URL shapes
  - Delivers: isolated tests that `list/read/create/update/delete/bulk-patch` hit `/admin/{routePath}` exactly as today
  - Files: `admin-frontend/src/isolated/hooks.isolated.tsx`, `useAdminApi` tests
  - Blocked by: none
  - Acceptance: URL/method goldens for all six operations; isolated suite green

- [x] **Task 1.7**: CRUD smoke E2E for embedded + SPA
  - Delivers: Playwright covering Todos list → create → edit → delete on `example-frontend` `/admin` and `admin-spa` `/console` (extend existing specs; do not skip login/consent)
  - Files: `example-frontend/e2e/admin.spec.ts` (or `admin-form.spec.ts`), `admin-spa/e2e/integration/adminSpa.integration.spec.ts` or new `admin-spa/e2e/crud.spec.ts`
  - Blocked by: none
  - Acceptance: specs assert visible row after create, field change after edit, row gone after delete; they pass locally against the documented full-stack commands
  - Skills: `verify-ui-changes` (record how to run; Phase 1 may land specs that CI runs)

---

## Phase 2 — Fetch wrapper (RPC off RTK)

- [x] **Task 2.1**: Tiny fetch client
  - Delivers: `adminRequest({url, method, body, signal})` using native `fetch`, AbortController timeout, JSON + FormData, maps failures to `APIError`; unit tests with mocked `globalThis.fetch`
  - Files: `admin-frontend/src/adminRequest.ts`, `admin-frontend/src/adminRequest.test.ts`
  - Blocked by: 1.1
  - Acceptance: tests for timeout abort, 4xx/5xx → APIError, JSON parse, FormData not JSON-stringified, credentials forwarded; no axios import
  - Skills: `terreno-data-fetching`

- [x] **Task 2.2**: Host-injected auth contract
  - Delivers: admin context accepts `{baseUrl, getAuthHeaders, credentials}`; SPA fixture uses `credentials: "same-origin"` and empty/cookie headers; embedded fixture uses Bearer from `getAuthHeaders`
  - Files: admin-frontend provider/context (existing Admin host types), tests
  - Blocked by: 2.1
  - Acceptance: unit tests prove Authorization header present/absent per fixture; cookie credential mode set
  - Skills: `terreno-data-fetching`

- [x] **Task 2.3**: Dual-run RPC hooks onto fetch
  - Delivers: `useAdminConfig`, scripts, roles, configuration, documents, comms, AI explorer, consent, version-config, background-tasks, `AdminObjectPicker` list fetch use `adminRequest` when the client is provided; if only `api` is provided, existing `injectEndpoints` still works
  - Files: `admin-frontend/src/useAdminConfig.ts`, `useAdminScripts.ts`, `useAdminRoles.ts`, `useConfigurationApi.ts`, `useDocumentStorageApi.ts`, `useAdminBackgroundTask.ts`, `useConsentHistory.ts`, `ConsentFormEditor.tsx`, `AdminVersionConfig.tsx`, `AdminObjectPicker.tsx`, `comms/useCommsDashboardApi.tsx`, `widgets/AIRequestsScreenWidget.tsx`, tests
  - Blocked by: 2.2, 1.6
  - Acceptance: each hook has tests for both backends; no behavior change when only `api` is passed
  - Skills: `terreno-data-fetching`

---

## Phase 3 — Protocol (`adminBroadcast` + window subscribe)

- [x] **Task 3.1**: `adminBroadcast` on `SyncConfig`
  - Delivers: optional `adminBroadcast?: boolean` on existing collection `sync` config; default false; registration stores the flag; docs comment in types
  - Files: `api/src/sync/types.ts`, `api/src/api.ts` (options plumbing), `api/src/sync/*.test.ts`
  - Blocked by: 1.5
  - Acceptance: registering with/without the flag; existing sync tests pass; no second `registerSync` for the same model
  - Skills: `terreno-backend-api`

- [x] **Task 3.2**: Emit deltas to `{collection}|admin`
  - Delivers: when `adminBroadcast` is true, change-stream / mutate emit also targets `{collection}|admin` in addition to the owner/tenant/broadcast stream
  - Files: emit path under `api/src/sync/` (change stream + mutate ack), tests
  - Blocked by: 3.1
  - Acceptance: unit/socket test: owner-scoped Todo create emits to `todos|owner:{id}` **and** `todos|admin`; flag false emits only the owner stream
  - Skills: `terreno-backend-api`

- [x] **Task 3.3**: Window subscribe — no snapshot, no full reconcile
  - Delivers: admin clients subscribe to `{collection}|admin` (or `sync:subscribe` with window mode) and receive **cursor/ack only**, not a full snapshot; syncdb skips `reconcile()` for that collection while in window mode
  - Files: `api/src/sync/socketHandlers.ts`, `syncdb/src/client.ts`, subscribe/bootstrap/reconcile modules, tests on both sides
  - Blocked by: 3.2
  - Acceptance: socket test: window subscribe does not emit snapshot pages; client test: reconcile interval does not GET `/sync/snapshot` for that collection
  - Skills: `terreno-backend-api`

- [x] **Task 3.4**: Hydrate known ids via REST + `GET /sync/entities`
  - Delivers: helper used by admin UI (or syncdb window API) that given ids upserts entities; missing rows fetched from `/sync/entities`; RBAC: only admin-capable users may subscribe to `|admin`
  - Files: `syncdb/src/sync/httpChannel.ts` (entities already), new window hydrate helper if needed, `api/src/sync/socketHandlers.ts` permission, tests
  - Blocked by: 3.3, 1.5
  - Acceptance: tests: hydrate 2 of 3 ids; unknown id ignored; non-admin subscribe to `|admin` nacks
  - Skills: `terreno-backend-api`, `terreno-data-fetching`

- [x] **Task 3.5**: Known-id-only deltas + Refresh contract
  - Delivers: delta applier in window mode updates/deletes **existing local ids only**; new server rows do not appear until membership Refresh or load-more upserts them
  - Files: `syncdb/src/sync/deltaApplier.ts`, tests
  - Blocked by: 3.3
  - Acceptance: tests: delta for unknown id is no-op; delta for known id updates store; delete delta removes known id; documented Refresh is a REST re-query + upsert (implemented in 4.x, contract tested here at applier)

---

## Phase 4 — Admin UI dual-run

- [x] **Task 4.1**: `AdminModelTable` windowed path
  - Delivers: when `syncDb` + fetch client present and model is String `_id` + synced + `adminBroadcast`, table membership from REST, rows from TinyBase, load more hydrates, Refresh control visible
  - Files: `admin-frontend/src/AdminModelTable.tsx`, tests
  - Blocked by: 3.4, 3.5, 2.2, 1.7
  - Acceptance: unit tests with fake syncdb: page ids render; extra delta id does not render; Refresh adds it; RTK path still used when `api` only
  - Skills: `terreno-ui`, `verify-ui-changes`

- [x] **Task 4.2**: `AdminModelForm` syncdb writes
  - Delivers: create/update/delete for String `_id` synced models go through `useMutate`; ObjectId models stay fetch/RTK dual-run
  - Files: `admin-frontend/src/AdminModelForm.tsx`, tests
  - Blocked by: 4.1
  - Acceptance: form save tests for both model classes; ObjectId never calls `useMutate`
  - Skills: `terreno-ui`

- [x] **Task 4.3**: ConflictSheet in admin
  - Delivers: `useConflicts` + `ConflictSheet` (`useServer` / `keepMine`) for admin-loaded ids, same as example app
  - Files: admin-frontend conflict host (table or shell), tests
  - Blocked by: 4.2
  - Acceptance: test: conflict row shows sheet; keepMine / useServer callbacks invoked
  - Skills: `terreno-ui`

- [x] **Task 4.4**: Bulk-patch stays fetch
  - Delivers: existing bulk-patch still uses fetch/RTK dual-run (not sync mutate) with goldens from 1.5/1.6 still passing
  - Files: table bulk actions wiring
  - Blocked by: 2.3, 4.1
  - Acceptance: bulk-patch tests still pass on both backends

---

## Phase 5 — Hosts

- [x] **Task 5.1**: example-frontend `/admin`
  - Delivers: `AdminProvider` gets fetch client (Bearer) + existing `syncDb`; example `Todo` `sync` sets `adminBroadcast: true`; `/admin` Todos changelist uses windowed path
  - Files: `example-frontend` admin layout/store, `example-backend/src/api/todos.ts` (`adminBroadcast: true`)
  - Blocked by: 4.3, 4.4
  - Acceptance: `bun run backend:dev` + `frontend:web`; Playwright from 1.7 still passes; new assertions for Refresh optional
  - Skills: `verify-ui-changes`, `generate-sdk` only if OpenAPI changed (should not)

- [x] **Task 5.2**: admin-spa `/console`
  - Delivers: same windowed Todos path with `credentials: "same-origin"`; SyncDbProvider in SPA; cookie session still logs in
  - Files: `admin-spa` app providers, e2e
  - Blocked by: 5.1
  - Acceptance: SPA CRUD E2E from 1.7 passes with the new path; no Bearer required for same-origin
  - Skills: `verify-ui-changes`

---

## Phase 6 — Docs, skills, deprecation

- [x] **Task 6.1**: Human + agent docs
  - Delivers: admin collection CRUD documented as windowed syncdb; RPC as fetch wrapper; `adminBroadcast` + window subscribe in syncdb reference; migrate-rtk guide no longer says admin collection CRUD stays RTK; `api`/`injectEndpoints` deprecated; next-major removal named; changelog
  - Files: `docs/reference/syncdb.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/reference/admin.md` / `admin-frontend` pages if present, `.rulesync/skills/terreno-data-fetching`, `verify-ui-changes` if admin login steps change, changelog
  - Blocked by: 5.2
  - Acceptance: `update-docs` checklist; `bun run skills:sync` if skill text changed; no remaining “keep admin on RTK” for **model CRUD**
  - Skills: `update-docs`, `update-agent-docs`

---

## Task graph (Pick frontier)

```
1.1 1.2 1.4 1.5 1.6 1.7
  └─ 1.3 (needs 1.1+1.2)

2.1 ← 1.1
2.2 ← 2.1
2.3 ← 2.2, 1.6

3.1 ← 1.5
3.2 ← 3.1
3.3 ← 3.2
3.4 ← 3.3, 1.5
3.5 ← 3.3

4.1 ← 3.4, 3.5, 2.2, 1.7
4.2 ← 4.1
4.3 ← 4.2
4.4 ← 2.3, 4.1

5.1 ← 4.3, 4.4
5.2 ← 5.1
6.1 ← 5.2
```

First Pick after Approved: **Task 1.1** (and any other Phase 1 tasks with `Blocked by: none` as the frontier).
