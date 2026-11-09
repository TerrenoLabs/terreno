# Admin Script Runner — Maintenance Scripts via `AdminApp`

**Status:** Implemented (ships with Admin UI v2 work; documented here as its own IP)  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1077
**Related:** [`admin-ui-v2-django-parity.md`](./admin-ui-v2-django-parity.md) (home `scriptRunner` widget, background-task patterns)  
**Primary packages:** `@terreno/api` (`BackgroundTask`, script types), `@terreno/admin-backend`, `@terreno/admin-frontend`, `admin-spa`, `example-backend`

## Goal

Let backends register **named, server-side maintenance scripts** on `AdminApp`. Admins discover them from **`GET /admin/config`** (`scripts[]`: `name` + `description` only — no code). Execution is **`POST {adminBase}/scripts/:name/run?wetRun=true|false`**, which creates a **`BackgroundTask`**, runs the `runner` async, and supports **poll** (`GET …/scripts/tasks/:id`) and **cancel** (`DELETE …/scripts/tasks/:id`). The admin UI exposes **`AdminScriptList`** + **`AdminScriptRunModal`** (dry/wet, logs, polling) and a **`scriptRunner`** home widget that deep-links to the scripts screen.

## Non-Goals

- Uploading or editing script source from the browser.
- Running scripts without authentication or without **admin** (`user.admin`).
- Replacing **`POST /admin/background-tasks`** for arbitrary job kinds — scripts are the **curated** list; background-tasks remain the generic enqueue API for config-driven actions.

## Decisions

| Topic | Decision |
|-------|-----------|
| Task storage | Reuse **`BackgroundTask`** from `@terreno/api` (`api/src/scriptRunner.ts`); `taskType` = script `name`. |
| Dry run | Query **`wetRun=false`** → `isDryRun: true` on the task; runners interpret per app conventions (see example-backend scripts). |
| Config surface | Only **`name`** and **`description`** in `/admin/config` — runners stay server-only. |
| UI entry | **`AdminShell`**: nav item when `scripts.length > 0`**; **`AdminHome`**: widget id **`scriptRunner`** (often placed in **`home.slots.navGlobal`** per Django-parity layout). |
| SPA routing | **`admin-spa`**: dedicated `app/scripts.tsx` and dynamic **`/__scripts`** under `app/[model]/index.tsx`. |

## Architecture

```
Browser
  │
  ├─ GET /admin/config          ← includes scripts: [{ name, description }]
  │
  ├─ POST /admin/scripts/:name/run?wetRun=…
  │     → 201 { taskId }        ← creates BackgroundTask, kicks async runner
  │
  ├─ GET  /admin/scripts/tasks/:id   ← poll status / logs / result
  │
  └─ DELETE /admin/scripts/tasks/:id ← cancel (running → cancelled)
```

Types: `ScriptRunner`, `ScriptContext`, `ScriptResult` in `api/src/scriptRunner.ts`.

### Phase completion (all shipped)

| Phase | Scope | Evidence |
|-------|--------|----------|
| A | Types + `BackgroundTask` | `api/src/scriptRunner.ts` |
| B | HTTP routes + config metadata | `admin-backend/src/adminApp.ts`; `admin-backend/src/adminApp.test.ts` (run, poll, cancel, wetRun, 403/404); `adminApp.models.test.ts` (`/admin/config` includes `scripts`) |
| C | Hooks + UI | `admin-frontend/src/useAdminScripts.ts`, `AdminScriptList.tsx`, `AdminScriptRunModal.tsx`, `AdminShell.tsx`, `AdminHome.tsx`; tests + isolated specs |
| D | SPA + example | `admin-spa/app/scripts.tsx`, `app/[model]/index.tsx` (`__scripts`); `example-backend/src/server.ts` `scripts` |

Script **run** paths are exercised in **`admin-backend` tests**; the aggregated **`openapi.json`** snapshot in **`example-backend`** documents `/admin/config` (including the `scripts` array shape) and may not list every dynamic `POST /admin/scripts/:name/run` path depending on OpenAPI aggregation — runtime behavior is still covered by admin-backend tests.

## APIs (implemented)

| Method | Path | Purpose |
|--------|------|--------|
| POST | `{basePath}/scripts/:name/run` | Start script; body empty; **`wetRun`** query boolean. |
| GET | `{basePath}/scripts/tasks/:taskId` | Poll task document (status, progress, logs, result). |
| DELETE | `{basePath}/scripts/tasks/:taskId` | Request cancellation. |

All script routes sit behind **`authenticateMiddleware()`**; run/poll/delete require **`user.admin`** (403 otherwise). See `admin-backend/src/adminApp.ts` (`mountScriptRoutes`).

## UI (implemented)

| Piece | Role |
|-------|------|
| `useAdminScripts` | RTK-injected endpoints for run / get task / cancel. |
| `AdminScriptRunModal` | Dry vs wet run, start, poll, show logs/results, cancel. |
| `AdminScriptList` | Lists scripts from config; opens modal. |
| `AdminHome` widget `scriptRunner` | Card + “Open scripts” → `__scripts` route. |
| `AdminShell` | Sidebar “Scripts” when `config.scripts.length > 0`. |

## Consumer wiring (example)

`example-backend/src/server.ts` — `new AdminApp({ … scripts: [{ name, description, runner }, …] })`. Runners may use only `wetRun` or also **`ScriptContext`** (`addLog`, `updateProgress`, `checkCancellation`) for long jobs.

## Files (reference)

| Area | Files |
|------|--------|
| Types + model | `api/src/scriptRunner.ts` (`ScriptRunner`, `BackgroundTask`, …) |
| HTTP + OpenAPI | `admin-backend/src/adminApp.ts` |
| Tests | `admin-backend/src/adminApp.test.ts`, `admin-backend/src/adminApp.models.test.ts` (ctx script) |
| Hooks + UI | `admin-frontend/src/useAdminScripts.ts`, `AdminScriptList.tsx`, `AdminScriptRunModal.tsx`, `AdminHome.tsx`, `AdminShell.tsx` |
| SPA | `admin-spa/app/scripts.tsx`, `admin-spa/app/[model]/index.tsx` (`__scripts`) |
| Example | `example-backend/src/server.ts` (`scripts` array) |

## Task list

Executable checklist: **`docs/tasks/admin-script-runner.md`**.

## Acceptance Criteria (summary)

- [x] `GET /admin/config` includes `scripts` metadata when scripts are registered; empty array when none.  
- [x] `POST …/scripts/:name/run` returns **201** + **`taskId`** for admins; **403** non-admin; **404** unknown name.  
- [x] `GET …/scripts/tasks/:id` exposes task state for polling; `DELETE` cancels where allowed.  
- [x] Runners receive **`wetRun`** and optional **`ScriptContext`**; failures mark task **failed**; **`TaskCancelledError`** respected.  
- [x] Frontend: list + modal + polling; dry vs wet surfaced to query string.  
- [x] `scriptRunner` home widget + shell nav reach the scripts screen without embedding the list inside the wrong slot (covered with Admin Home tests + layout rules in Admin UI v2 IP).

## Future / not in scope

- Per-script RBAC beyond “is admin”.  
- Streaming log output over WebSockets (polling only today).  
- Shared quota / concurrency limits across script and background-task queues.
