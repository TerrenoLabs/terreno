# Task List: Admin Script Runner

*Companion to **Admin UI v2 — Django-parity** (`docs/tasks/admin-ui-v2-django-parity.md`). Script runner ships as part of the same admin stack; this list tracks script-specific deliverables.*

**Status:** Complete — implementation lives in `@terreno/api`, `@terreno/admin-backend`, `@terreno/admin-frontend`, and `admin-spa`. See **`docs/implementationPlans/admin-script-runner.md`**.

See: `docs/implementationPlans/admin-script-runner.md` for the full plan.

## Phase A: Types and persistence (`@terreno/api`)

- [x] **Task A.1**: `ScriptResult`, `ScriptContext`, `ScriptRunner`, `TaskCancelledError`  
  - Files: `api/src/scriptRunner.ts`  
  - Acceptance: Typed runner signature; context supports logs, progress, cancellation check.

- [x] **Task A.2**: `BackgroundTask` Mongoose model  
  - Files: `api/src/scriptRunner.ts`  
  - Acceptance: Used by AdminApp for script runs; indexes and methods (`addLog`, `updateProgress`, `checkCancellation` static).

## Phase B: HTTP surface (`@terreno/admin-backend`)

- [x] **Task B.1**: Mount `{basePath}/scripts` router when `AdminOptions.scripts` non-empty  
  - Files: `admin-backend/src/adminApp.ts`  
  - Acceptance: Routes covered by `adminApp.test.ts`; `/admin/config` OpenAPI schema includes `scripts` array (see example-backend `openapi.test.ts` snapshot). Per-script `POST …/run` paths may not appear as separate paths in merged consumer OpenAPI; behavior is verified in admin-backend tests.

- [x] **Task B.2**: Implement run → create task → async `runner(wetRun, ctx)` → terminal status  
  - Acceptance: Tests in `admin-backend/src/adminApp.test.ts` (happy path, 403, 404, failure, cancel, wetRun query).

- [x] **Task B.3**: Include `scripts: { name, description }[]` in `GET /admin/config`  
  - Acceptance: `adminApp.test.ts` / `adminApp.models.test.ts` assertions.

## Phase C: Admin frontend

- [x] **Task C.1**: `useAdminScripts` — RTK mutations/queries for run, get task, cancel  
  - Files: `admin-frontend/src/useAdminScripts.ts`, isolated hook tests.

- [x] **Task C.2**: `AdminScriptRunModal` + `AdminScriptList`  
  - Files: `AdminScriptRunModal.tsx`, `AdminScriptList.tsx`, tests + isolated specs.

- [x] **Task C.3**: Shell nav + home **`scriptRunner`** widget  
  - Files: `AdminShell.tsx`, `AdminHome.tsx`, `AdminHome.test.tsx`  
  - Acceptance: Widget can live in `navGlobal` / other slots; tests ensure it does not incorrectly mount inside `main` when only `navGlobal` lists it (see Admin UI v2 home tests).

## Phase D: `admin-spa` + example-backend

- [x] **Task D.1**: Routes for scripts screen (`/__scripts`, dedicated `scripts` route)  
  - Files: `admin-spa/app/[model]/index.tsx`, `admin-spa/app/scripts.tsx`.

- [x] **Task D.2**: Example scripts (count, sync consents, seed flags)  
  - Files: `example-backend/src/server.ts`  
  - Acceptance: Scripts appear in config; runnable against dev server.
