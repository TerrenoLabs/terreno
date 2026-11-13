# Task List: Admin UI v2 — Django-Parity Admin (Config-Driven Shell)

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

**Status:** All phases below are complete. See `docs/implementationPlans/admin-ui-v2-django-parity.md` for acceptance criteria (also marked complete) and verification pointers.

**Companion:** **Admin script runner** — `docs/implementationPlans/admin-script-runner.md` + `docs/tasks/admin-script-runner.md` (same delivery; documents `/admin/scripts/*`, `BackgroundTask`, and UI).

See: `docs/implementationPlans/admin-ui-v2-django-parity.md` for full plan.

## Phase 1: Admin config contract (backend)

- [x] **Task 1.1**: Extend `AdminConfigResponse` / `GET /admin/config` for schema v2  
  - Description: Add `schemaVersion`, per-model `group`, `listDisplay`, `listDisplayLinks`, `sortableFields`, `searchFields`, `filters` (typed: boolean, choice, text, dateRange, ref), `fieldsets`, `readonlyFields`, `hiddenFields`, declared `actions` (sync vs `background: true`), `permissions` (`create`/`update`/`delete` booleans), `pageSize`, `realtime`, `home` with **`title` + `slots`** (`navGlobal?`, `contentTop?`, `main?`, `sidebar?` — each an ordered `string[]` of widget ids; Django template-block analogue). Optionally accept legacy `home.widgets[]` for migration → normalize into `slots.main` + `recentActivity` forced last in `sidebar`. Include `customScreens`, existing `scripts`. Preserve v1 config fields for backward compatibility.  
  - Files: `admin-backend/src/adminApp.ts`, `admin-backend/src/index.ts` (exports if needed), tests under `admin-backend/src/*.test.ts`  
  - Depends on: none  
  - Acceptance: Typed response; tests assert v1 fields still present; new fields optional-safe for old clients.

- [x] **Task 1.2**: Document OpenAPI for extended config  
  - Description: Ensure generated OpenAPI documents the new response shape (or manual `openApiBuilder` attachment on config route if required).  
  - Files: `admin-backend/src/adminApp.ts`  
  - Depends on: 1.1  
  - Acceptance: `openapi.json` from a test server includes `/admin/config` response schema additions.

## Phase 2: Bulk patch + background tasks (backend)

- [x] **Task 2.1**: Implement `POST {basePath}{routePath}/bulk-patch`  
  - Description: Body `{ ids: string[]; patch: Record<string, unknown> }`. Enforce **max 1000** ids. Allowlist patch keys per model from config (or from schema paths). Use `updateMany` / batched updates with per-id validation where needed. Return `{ updated: number; failures?: ... }`.  
  - Files: `admin-backend/src/adminApp.ts`, new helper module if >300 LOC, tests  
  - Depends on: 1.1  
  - Acceptance: Tests for cap, unknown keys rejected, partial failure reporting; `IsAdmin` only.

- [x] **Task 2.2**: Implement `POST /admin/background-tasks` (name finalized in code)  
  - Description: Map prototype `background: true` actions to enqueue `BackgroundTask` (or existing script runner) with `kind`, target route, ids, metadata. Return `{ taskId }`. Reuse logging/error patterns from script routes.  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 1.1, 2.1 (shared validation helpers optional)  
  - Acceptance: Test covers enqueue + 403 non-admin; OpenAPI entry exists.

## Phase 3: modelRouter metadata parity (backend / examples)

- [x] **Task 3.1**: Align `modelRouter` registration options with config lists  
  - Description: For each model exposed in `example-backend` (or chosen demo), set `queryFields`, `sort`, `defaultLimit`/`maxLimit`, `responseHandler` for hidden fields, and `permissions.delete: []` for DotPhrase-style demo.  
  - Files: `example-backend/src/**`, any consumer `AdminApp` registration  
  - Depends on: 1.1  
  - Acceptance: List queries accept filters used in UI; delete disabled where specified.

## Phase 4: Admin frontend — shell + navigation

- [x] **Task 4.1**: Admin shell (sidebar groups, screens, tools, user footer)  
  - Description: New layout components using `@terreno/ui`; consume config for groups and `customScreens`; support `apiBase`/`routeBase` from prior admin-spa work.  
  - Files: `admin-frontend/src/**` (new shell module + exports in `index.tsx`)  
  - Depends on: 1.1  
  - Acceptance: Lint/compile; story or test renders grouped nav from mock config.

- [x] **Task 4.2**: Top bar breadcrumbs + contextual actions  
  - Description: Match prototype routes (home, list, form, tool, screen); “Add {singular}” when `permissions.create !== false`.  
  - Files: `admin-frontend/src/**`  
  - Depends on: 4.1  
  - Acceptance: Unit test for breadcrumb labels from route + model meta.

## Phase 5: Admin frontend — list (changelist)

- [x] **Task 5.1**: List view v2 — search, filters, sort, pagination  
  - Description: Wire `DataTable` to server sort/page; debounced search; typed filters mapped to query params; `listDisplayLinks` drives link columns; inline boolean uses PATCH.  
  - Files: `admin-frontend/src/AdminModelTable.tsx`, hooks, types  
  - Depends on: 1.1, 3.1, 4.1  
  - Acceptance: Tests with MSW or harness for query serialization; loading/error/empty states.

- [x] **Task 5.2**: Bulk selection + action menu  
  - Description: Sync actions call `bulk-patch`; confirm modals for `confirm` strings; background actions call enqueue endpoint; cap selection client-side at 1000 with user-visible message.  
  - Files: `admin-frontend/src/AdminModelTable.tsx`, possibly `AdminScriptRunModal.tsx` reuse  
  - Depends on: 2.1, 2.2, 5.1  
  - Acceptance: Tests for confirm + request bodies.

## Phase 6: Admin frontend — form (change view)

- [x] **Task 6.1**: Fieldsets + readonly + exclude/hidden fields  
  - Description: Render `fieldsets` with `Accordion`/`Card`; readonly fields not submitted; hidden fields omitted from form and detail panels as specified.  
  - Files: `admin-frontend/src/AdminModelForm.tsx`, types  
  - Depends on: 1.1, 4.1  
  - Acceptance: Test that PATCH body excludes readonly keys.

- [x] **Task 6.2**: Autocomplete ref picker  
  - Description: Debounced fetch against referenced model list endpoint; keyboard/accessibility basics.  
  - Files: `admin-frontend/src/AdminRefField.tsx` or new component, tests  
  - Depends on: 5.1 (shared debounce util optional)  
  - Acceptance: Unit test uses mock list API.

## Phase 7: Home dashboard widgets

- [x] **Task 7.1**: Widget registry + **`home.slots`** layout  
  - Description: Implement built-ins: `modelStats`, `modelsGrid`, `feature-flags-overrides` (or generic “quick toggles” plugin slot), `versionConfig` summary, `scriptRunner`, `recentActivity`. Render regions in order: **`navGlobal`** (horizontal strip) → **`contentTop`** (full-width above grid) → **`main` | `sidebar`** (two-column). Enforce **`recentActivity` last within `sidebar`** when present. Validate unknown widget ids in dev.  
  - Files: `admin-frontend/src/**` (new `AdminHome.tsx` or similar), exports  
  - Depends on: 1.1, 4.1  
  - Acceptance: Tests: (1) `scriptRunner` only in `navGlobal` does not mount inside `main` model grid; (2) `recentActivity` is last in `sidebar` when configured.

## Phase 8: admin-spa + example integration

- [x] **Task 8.1**: Wire new shell + routes in `admin-spa`  
  - Description: Routes for home v2, list, form, tools, deep links to plugin URLs for screens; regenerate admin SDK if needed.  
  - Files: `admin-spa/app/**`, `admin-spa/store/**`  
  - Depends on: 4.x–7.x  
  - Acceptance: `bun run admin-spa:compile` / smoke script; manual checklist in plan.

- [x] **Task 8.2**: Example-backend registration + seed  
  - Description: Register illustrative models + `AdminApp` config entries matching v2 demo shape (subset acceptable).  
  - Files: `example-backend/**`  
  - Depends on: 3.1  
  - Acceptance: Running example + admin-spa exercises list/form/home.

## Phase 9 (last): Audit log + recent actions

- [x] **Task 9.1**: `AdminAuditLog` model + persistence (consumer or example-backend)  
  - Description: Schema with descriptions, indexes on `created`, `modelName`, `actorId`. Optional TTL for retention.  
  - Files: `example-backend/src/models/**` (or consumer app), types  
  - Depends on: 8.2 (demo path)  
  - Acceptance: Model compiles; `checkModelsStrict` happy in non-prod.

- [x] **Task 9.2**: `modelRouter` or read-only list route for audit entries  
  - Description: `GET` list with pagination, `IsAdmin`, sort `-created`. Consider create-only via internal hooks (no public POST from browser) — prefer server-side logging middleware writing entries.  
  - Files: `example-backend/src/api/**`, tests  
  - Depends on: 9.1  
  - Acceptance: supertest list route returns inserted fixture rows.

- [x] **Task 9.3**: Emit audit rows from admin mutations  
  - Description: Hook `postUpdate`/`postCreate`/`postDelete` on registered admin models or central middleware in `AdminApp` to write `AdminAuditLog` with verb + label resolution.  
  - Files: `admin-backend/src/adminApp.ts` and/or example-backend hooks  
  - Depends on: 9.2  
  - Acceptance: `onAdminAudit` fires after POST/PATCH/DELETE on admin model routes — **`admin-backend/src/adminApp.models.test.ts`** (`describe("AdminApp onAdminAudit")`). Consumer persistence: `example-backend/src/server.ts` (`AdminAuditLog.create` in `onAdminAudit`).

- [x] **Task 9.4**: Home `recentActivity` widget backed by API  
  - Description: Fetch latest N audit rows; render as the **final widget in `home.slots.sidebar`**; empty/error states.  
  - Files: `admin-frontend/src/**` (home widget), `useAdminApi` or dedicated hook  
  - Depends on: 7.1, 9.3  
  - Acceptance: UI or integration test shows `recentActivity` below other **sidebar** widgets when multiple sidebar ids are configured.
