# Implementation Plan: Migrate built-in admin to syncdb

**Status:** Complete
**Roadmap:** Area=`admin`, Target=`Released`, Impact=`Improvement`  
**Branch:** `cursor/migrate-admin-to-syncdb-de61`
**Owner:** Josh Gachnang
**Created:** 2026-09-01
**Grow run:** https://cursor.com/agents/bc-47350376-6566-4c5a-aee2-e6a28698de61

## Goal

Move **built-in admin model list/read/create/update/delete** for collections that already use **String `_id`** onto **windowed local-first syncdb**, with **REST remaining the membership source** (search, sort, pagination, RBAC). Remaining admin RPC (config, scripts, roles, comms, AI, consent, documents, version-config, background-tasks) leaves RTK `injectEndpoints` for a **tiny native `fetch` wrapper** with **host-injected auth**.

Ship **great characterization coverage and CI first**, then protocol, then UI, then hosts. Dual-run RTK `api` for one release so existing hosts keep working; **deprecate `api` / `injectEndpoints` in docs in this IP**; **delete the inject path in the next Terreno major**.

## Non-Goals

- Migrating ObjectId `_id` models (`User`, `AdminAuditLog`, and any other ObjectId collection) onto syncdb. Those stay **fetch CRUD**. No schema migration in this IP.
- Axios. Admin HTTP uses native `fetch` plus a small wrapper.
- Full-stream `reconcile()` for admin collections. Admin subscribe is **window mode**: no snapshot of the entire owner/tenant/broadcast stream.
- A second `sync:` registration on the admin `modelRouter`. One sync registration per model stays on the **app** router (`/todos`, not `/admin/todos`).
- Changing app-user collections to broadcast. Users keep owner/tenant streams; admin is an extra fan-in (`adminBroadcast`).
- Removing `injectEndpoints` in this release (next major).
- Replacing generated OpenAPI SDK, Better Auth Redux, or feature-flag RTK with syncdb.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| Q1 | What data plane does admin use? | String-`_id` **model CRUD** → **syncdb** (windowed). Remaining admin **RPC is not RTK**; dedicated **fetch** hooks. |
| Q2 | Coverage-first? | **A:** ≥95% line+function on admin packages; **fix CI coverage scope**; add embedded + SPA CRUD E2E **before** behavior migration. |
| Q3 | HTTP client | Native **`fetch` + tiny wrapper** (AbortController timeout, credentials, JSON/FormData, `APIError`). **No axios**. |
| Q4 | Auth injection | Host injects `{baseUrl, getAuthHeaders, credentials}`. SPA: `credentials: "same-origin"`. Embedded: Bearer. |
| Q5 | Local-first shape | **Windowed local-first:** load more hydrates more; keep loaded rows synced. |
| Q6 | Which models? | **B:** Sync only models that already have **String `_id`**. ObjectId models stay fetch CRUD. |
| Q7 | RTK dual-run | **B:** Dual-run **this release** (`api` still works). Delete RTK inject path **next major**. |
| Q8 | List membership vs store | **A:** REST list/search/sort/RBAC stays **membership**. Pages **upsert** into TinyBase. Writes + per-id via syncdb. **Full-stream reconcile OFF** for admin collections. |
| Q9 | Deltas vs new matches | **A + Refresh:** deltas **update/delete known ids only**. New matches via load-more or **visible Refresh**. No surprise inserts. |
| Q10 | Owner streams? | Admin needs a **cross-owner** view. Not the signed-in admin's owner stream. |
| Q11 | Dual-run vs cutover | Land **both** in this IP. **Deprecate `api` in docs now**. Remove `injectEndpoints` **next Terreno major**. |
| Q12 | Conflicts | **`ConflictSheet`** (`useServer` / `keepMine`) like the example app. |
| Q13 | Fan-in | **`adminBroadcast: true`** on the **existing** collection `SyncConfig`. Deltas also to `{collection}\|admin`. Admin clients join in **window** mode: no full snapshot/reconcile; hydrate via REST ids + `GET /sync/entities`. |

## Architecture

### Today

Admin CRUD is **RTK `injectEndpoints`** in `@terreno/admin-frontend` (`useAdminApi.ts` → `GET/POST/PATCH/DELETE /admin/{routePath}` plus bulk-patch). Config and other RPC are more inject hooks (`useAdminConfig`, scripts, roles, configuration, documents, comms, AI explorer, consent, version-config, background-tasks).

The backend mounts a **separate** `modelRouter` under `/admin/...` **without** `sync:`. Example `Todo` is already synced on the **app** router (`example-backend/src/api/todos.ts`) with String `_id` + `syncPlugin`. Same Mongo model, different mount. Registry allows **one sync registration per model**; a second `sync` on the admin router is forbidden (`api/src/sync/registrationSideEffects.ts`).

Canonical docs still say profile/admin stay on RTK (`docs/how-to/migrate-rtk-to-syncdb.md`).

### Target data planes

| Surface | After this IP | Auth |
| --- | --- | --- |
| String-`_id` model changelist + form | REST membership + TinyBase rows + `{collection}\|admin` window subscribe | Host-injected (cookie or Bearer) via fetch for REST; existing sync socket auth for deltas/mutate |
| ObjectId model changelist + form | Fetch CRUD only (same `/admin/{routePath}` URLs) | Same fetch wrapper |
| Admin RPC (config, scripts, roles, comms, …) | Fetch hooks; **not** RTK | Same fetch wrapper |
| Host RTK `api` | Still accepted; dual-run. Deprecated in docs | Unchanged |

### Windowed local-first (String `_id`)

1. **Membership:** `GET /admin/{routePath}` (existing list/search/sort/RBAC) returns the **page of ids** (and enough fields to render immediately).
2. **Hydrate:** those ids **upsert** into TinyBase. Missing entities come from `GET /sync/entities` (already exists) when the list payload is incomplete for sync seq / tombstones.
3. **Subscribe:** admin client joins collection stream `{collection}|admin` in **window** mode. Socket handlers must **not** send a full snapshot or trigger client `reconcile()` of the whole user stream.
4. **Deltas:** apply **update/delete only if the id is already in the local window**. Unknown ids are ignored (no surprise inserts).
5. **Load more / Refresh:** load more requests the next REST page and hydrates those ids. **Refresh** re-runs the current REST query and upserts/removes to match membership (visible control).
6. **Writes:** `useMutate` / `POST /sync/mutate` (same write path as the app) plus admin REST bulk-patch remaining on fetch until a later IP if bulk is not a sync mutation.

Do **not** set collection `scope` to broadcast for the app. App clients keep owner/tenant streams. `adminBroadcast: true` is an **additive fan-in**: change-stream emit also publishes to `{collection}|admin`. Only clients that subscribe in admin window mode join that stream.

### Why not a second sync registration

`registerSync` throws if the model is already registered. Admin REST stays the **admin RBAC/list** surface. Sync stays on the **app** collection registration. Admin UI does not invent a second TinyBase table name; it uses the same collection tag as the app (`todos`), with an admin stream suffix.

### Fetch wrapper

New module in `@terreno/admin-frontend` (not axios, not `emptyApi` JWT refresh). Responsibilities:

- `AbortController` timeout
- `credentials` (`same-origin` for SPA cookies; `omit`/`include` as injected)
- `getAuthHeaders()` for Bearer (embedded)
- JSON body by default; `FormData` passthrough
- Map non-2xx to `APIError` shape admin already understands

Hosts pass `{baseUrl, getAuthHeaders, credentials}` into `AdminProvider` / existing admin context. SPA must keep cookie session working; embedded example-frontend must keep Bearer.

### Dual-run

`AdminModelTable` / `AdminModelForm` / related hooks:

- If `syncDb` + `adminRequest` (fetch client) are present **and** the model is String `_id` + registered for sync with `adminBroadcast`, use the new path.
- Else existing `useAdminApi(api, …)` RTK path.

No host is forced to pass `syncDb` this release. Docs tell new/updated hosts to inject both.

### Conflicts

Same `ConflictSheet` as the example app: `useServer` / `keepMine`. Admin window does not invent a second conflict UX.

## Models

No new Mongo models. No `_id` type changes.

| Model (example) | `_id` | This IP |
| --- | --- | --- |
| `Todo` | String | Tracer: windowed syncdb + adminBroadcast |
| Other app models already String `_id` + `sync` | String | Same pattern once `adminBroadcast: true` |
| `User`, `AdminAuditLog`, other ObjectId | ObjectId | Fetch CRUD only |

`SyncConfig` gains:

```ts
adminBroadcast?: boolean;
```

Default `false`. When `true`, emitters also send deltas to `{collection}|admin`. Permission to join that stream is **admin-only** (reuse existing admin permission checks used by `/admin/*`, not owner-stream membership).

## APIs

### Additive protocol

| Piece | Change |
| --- | --- |
| `SyncConfig.adminBroadcast` | Opt-in fan-in to `{collection}\|admin` |
| `sync:subscribe` | Accept window/admin mode (exact payload field named in Pick; suggested `{mode: "window"}` or subscribe to `{tag}\|admin` without snapshot) |
| `sync:subscribed` | Must not dump full stream snapshot for window subscribers |
| `GET /sync/entities` | Hydrate known ids (already exists; pin tests) |
| `GET /admin/{routePath}` | Unchanged membership/search/RBAC |
| `POST /sync/mutate` | Writes for String `_id` synced models (already exists) |

### Unchanged REST (still used)

- `GET /admin/config`
- `/admin/{routePath}` list/read/create/update/delete/bulk-patch (membership + ObjectId CRUD + bulk)
- `/rbac/*`, scripts, configuration, documents, comms, AI, consent, version-config, background-tasks

## Notifications

None. No user-facing comms templates.

## UI

- **Changelist (`AdminModelTable`):** windowed rows from TinyBase for String `_id` synced models; REST pagination/search/sort unchanged; **Refresh** control; load more hydrates more ids; no rows appearing that were not in the last membership set.
- **Form (`AdminModelForm`):** read/write via syncdb for those models; ObjectId stays fetch.
- **Conflicts:** `ConflictSheet` when `useConflicts` reports for admin-loaded ids.
- **Hosts:** `example-frontend` `/admin` and `admin-spa` `/console` both wired for the tracer.
- Admin v2 `home.slots` unchanged.

## Phases

1. **Characterization + CI** — raise coverage, fix LCOV scope, add package CI jobs, pin URL goldens, add CRUD E2E. **No product behavior change.**
2. **Fetch wrapper** — client + host injection; migrate RPC inject hooks onto fetch (dual-run until hosts pass the wrapper).
3. **Protocol** — `adminBroadcast`, `{collection}|admin` emit, window subscribe, skip reconcile, known-id delta apply, entity hydrate tests.
4. **Admin UI dual-run** — table/form/ConflictSheet/Refresh; ObjectId stays fetch.
5. **Hosts** — example-frontend + admin-spa; cookie vs Bearer must both work.
6. **Docs/skills** — stop saying admin collection CRUD stays RTK; deprecate `api` inject; changelog.

Phase 1 is a **hard gate**. Protocol/UI tasks are blocked until Phase 1 acceptance is green.

## Feature Flags & Migrations

No feature flag. `adminBroadcast` is explicit per collection. Hosts opt into the new UI path by passing `syncDb` + fetch client.

**Deprecation:** this release documents “do not add new `injectEndpoints` in admin-frontend.” Next major deletes `useAdminApi` RTK inject and the `api` prop requirement.

## Activity Log & User Updates

No end-user product changelog beyond admin operators. Framework changelog records protocol + deprecation.

## Not Included / Future Work

- ObjectId → String `_id` + `syncPlugin` for User / audit log (own IP; mongoose-schema-safety).
- Delete RTK inject (next major).
- Bulk-patch as sync mutations.
- Admin-only collections with no app router (would still need one `sync:` registration, not a duplicate).

## Files to Create / Modify

**Phase 1:** `admin-frontend/**/*.test.*`, `admin-frontend/bunfig.toml`, `admin-backend` coverage config, `.circleci/continue-config.yml`, root `package.json` (`admin-frontend:test`), `example-frontend/e2e/admin*.spec.ts`, `admin-spa/e2e/**`.

**Phase 2:** `admin-frontend/src/adminRequest.ts` (name at Pick), host context types, RPC hooks listed under Architecture.

**Phase 3:** `api/src/sync/types.ts`, `streams.ts`, change-stream emit, `socketHandlers.ts`, `syncdb/src/client.ts` + subscribe/reconcile/delta applier, tests in `api/src/sync/*.test.ts` and `syncdb/src/sync/*.test.ts`.

**Phase 4:** `AdminModelTable`, `AdminModelForm`, conflict wiring, `useAdminApi` dual-run.

**Phase 5:** `example-frontend` store/syncdb + admin layout; `admin-spa` session fetch + SyncDbProvider.

**Phase 6:** `docs/reference/admin-*.md`, `docs/reference/syncdb.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/reference/admin-frontend.md` (if present), `terreno-data-fetching` skill (admin fetch exception), `verify-ui-changes`, changelog.

## Task List

[docs/tasks/migrate-admin-to-syncdb.md](../tasks/migrate-admin-to-syncdb.md)

## Acceptance Criteria

- [ ] `admin-frontend` and `admin-backend` report ≥95% line and function coverage on **package source** (not `@terreno/test/dist`). CircleCI runs both package jobs.
- [ ] Embedded `/admin` and SPA `/console` have CRUD E2E for Todos (list, create, edit, delete, search/filter, bulk where already specified) **before** protocol/UI cutover, and they still pass after cutover.
- [ ] Example **Todos** admin changelist is windowed local-first: REST membership, TinyBase rows, `{todos}|admin` deltas update known ids only, Refresh/load-more add membership, ConflictSheet works.
- [ ] ObjectId models still CRUD via fetch; no `_id` migration.
- [ ] SPA cookie auth and embedded Bearer auth both work; no axios in the new client.
- [ ] Hosts that still pass only `api` keep working (dual-run).
- [ ] Docs and skills no longer tell agents to keep admin **collection CRUD** on RTK; `api`/`injectEndpoints` marked deprecated; next-major removal called out.
- [ ] `bun run lint` and focused package tests pass; `verify-ui-changes` for `/admin` and `/console` tracer.

## Tracer

Example **Todos** admin changelist: `example-frontend` `/admin` and `admin-spa` `/console`.
