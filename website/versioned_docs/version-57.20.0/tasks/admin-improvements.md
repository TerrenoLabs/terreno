# Task List: Admin Improvements (post–Admin UI v2)

*Executable checklist for the gap after [Admin UI v2](./admin-ui-v2-django-parity.md). See [admin-improvements.md](../implementationPlans/admin-improvements.md).*

**Decisions (2026-08-20):** Full IP; bulk actions = v2 `bulk-patch` only (no `/actions/:name`); `home.slots`; static permissions; `filterParser`; widgets in `admin-frontend/src/widgets/`; atomic example migration; new roadmap issue.

---

## Phase 0 — Admin UI v2 baseline (complete)

*Do not re-implement. Reference: `docs/implementationPlans/admin-ui-v2-django-parity.md`.*

- [x] **Task 0.1**: Config contract `schemaVersion: 2`, model meta, `home.slots`, scripts, customScreens  
  - Evidence: `admin-backend/src/adminApp.models.test.ts`

- [x] **Task 0.2**: `bulk-patch` + `background-tasks` + script runner  
  - Evidence: `admin-backend/src/adminApp.ts`, `admin-script-runner.md`

- [x] **Task 0.3**: `AdminShell`, `AdminHome`, list search/filters/bulk (inline), form fieldsets/readonly  
  - Evidence: `admin-frontend/src/AdminShell.tsx`, `AdminHome.tsx`, `AdminModelTable.tsx`, `AdminModelForm.tsx`

- [x] **Task 0.4**: Audit log + `recentActivity` widget  
  - Evidence: `example-backend` `AdminAuditLog`, `AdminHome.test.tsx`

- [x] **Task 0.5**: admin-spa + example v2 demo  
  - Evidence: `admin-spa/`, `example-backend/src/server.ts` v2 registrations

---

## Phase 1 — Core API surface (`@terreno/api`)

- [x] **Task 1.0**: Extend `TerrenoPlugin.register` additively  
  - `register(app, openApi?, terrenoApp?)`; `TerrenoApp.build()` passes `this`; rename `_buildWithOpenApi` → `_buildWithContext({openApi, terrenoApp})`; `setMaxListeners(50)`  
  - Files: `api/src/terrenoPlugin.ts`, `terrenoApp.ts`, `api.ts`  
  - Acceptance: Existing plugins compile; test receives `terrenoApp` as third arg.

- [x] **Task 1.1**: `api/src/adminTypes.ts`  
  - Export `AdminConfig`, `AdminFilter`, `AdminFieldset`, `AdminContribution`, `AdminModelContribution`, `AdminCustomScreen`, `AdminHomeWidgetContribution`, `AdminChangeEvent`, etc. (no `AdminAction.run` — bulk stays declarative v2 shape)  
  - Files: `api/src/adminTypes.ts`, `index.ts`  
  - Acceptance: `bun run compile` clean across monorepo.

- [x] **Task 1.2**: `admin?: AdminConfig` on `ModelRouterOptions`  
  - Files: `api/src/api.ts`  
  - Depends on: 1.1

- [x] **Task 1.3**: `TerrenoApp.getRegistrations()` + `getPlugins()`  
  - Files: `api/src/terrenoApp.ts`, tests  
  - Depends on: none

- [x] **Task 1.4**: `TerrenoPlugin.adminContribution?()`  
  - Files: `api/src/terrenoPlugin.ts`  
  - Depends on: 1.1

- [x] **Task 1.5**: Typed event bus (`admin:model.changed`)  
  - Files: `api/src/terrenoApp.ts`, tests  
  - Depends on: 1.1

- [x] **Task 1.6**: `scrubAdminFields` helper + populated recursion  
  - Files: `api/src/scrubAdminFields.ts`, tests  
  - Depends on: 1.1

- [x] **Task 1.7**: Emit scrubbed `admin:model.changed` when `admin.realtime`  
  - Files: `api/src/api.ts`, tests  
  - Depends on: 1.0, 1.2, 1.5, 1.6

- [x] **Task 1.8**: `readonlyFields` / `excludeFields` enforcement on body-accepting routes  
  - Files: `api/src/api.ts`, tests  
  - Depends on: 1.0, 1.2, 1.6

- [x] **Task 1.9**: Wire `scrubAdminFields` into admin response paths (populated refs)  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 1.6, 2.2

---

## Phase 2 — Admin backend aggregation

- [x] **Task 2.1**: `legacy.ts` adapter + deprecation warnings  
  - Files: `admin-backend/src/legacy.ts`, tests  
  - Depends on: 1.1

- [x] **Task 2.2**: Aggregate from modelRouter `admin:` + plugins + legacy `models`  
  - Precedence: registered router > plugin > legacy; throw on duplicate registered `routePath`  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 1.3, 1.4, 2.1

- [x] **Task 2.3**: Merge `customScreens`, `homeWidgets` → `widgetIds`, plugin `scripts`  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 2.2

- [x] **Task 2.4**: Add `widgetIds`, `capabilities` to `/admin/config` (additive; v2 fields unchanged)  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 2.2

- [x] **Task 2.5**: Static `permissions` flags on config (v2 behavior — **no per-user eval**)  
  - Verify/document: flags reflect `adminPermissions` config, not runtime user  
  - Files: `admin-backend/src/adminApp.ts` (docs/tests only if already correct)  
  - Depends on: 2.4

- [x] **Task 2.6**: `filterParser.ts` — strict per-type validation, injection hardening  
  - Accept v2-compatible query shapes (`field`, `field_gte`/`field_lte` for dateRange, etc.)  
  - Files: `admin-backend/src/filterParser.ts`, tests (matrix from original IP)  
  - Depends on: 1.1

- [x] **Task 2.7**: Wire filterParser + `adminFilter` async + `sortableFields` enforcement  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 2.6

- [x] **Task 2.8**: `routePath` normalization + collision rules  
  - Files: `admin-backend/src/adminApp.ts`, tests  
  - Depends on: 2.2

- [x] **Task 2.9**: Export types from `admin-backend/src/index.ts`  
  - Depends on: 2.2

---

## Phase 3 — Admin frontend foundations

- [x] **Task 3.1**: `AdminProvider` + three-bucket widget registry + hooks  
  - Files: `admin-frontend/src/AdminProvider.tsx`, `types.ts`, tests  
  - Depends on: none

- [x] **Task 3.2**: Extend frontend types for `widgetIds`, `capabilities`, `autocompleteFields`, `excludeFields`  
  - Files: `admin-frontend/src/types.ts`  
  - Depends on: 2.4

- [x] **Task 3.3**: `AdminScreenRouter`  
  - Files: `admin-frontend/src/AdminScreenRouter.tsx`, tests  
  - Depends on: 3.1, 3.2, 2.3

- [x] **Task 3.4**: Refactor `AdminHome` — slots + registry (built-ins + plugin ids)  
  - Extract widget renderers to `widgets/`; keep slot layout from v2  
  - Files: `admin-frontend/src/AdminHome.tsx`, `widgets/*`, tests  
  - Depends on: 3.1, 3.2

- [x] **Task 3.5**: Extract built-in widgets to `widgets/`  
  - `ModelsGridWidget`, `ModelStatsWidget`, `RecentActivityWidget`, `ScriptRunnerWidget`, `CustomScreensListWidget`, `VersionConfigWidget`  
  - Files: `admin-frontend/src/widgets/*.tsx`, tests  
  - Depends on: 3.4

- [x] **Task 3.6**: `AdminFieldRenderer` + form widget lookup from context  
  - Files: `AdminFieldRenderer.tsx`, `AdminModelForm.tsx`, tests  
  - Depends on: 3.1

- [x] **Task 3.7**: `AdminModelList` thin wrapper → `AdminHome` + deprecation for `customScreens` prop  
  - Files: `AdminModelList.tsx`  
  - Depends on: 3.4

- [x] **Task 3.8**: Package exports (`AdminProvider`, `AdminScreenRouter`, `BUILT_IN_*_WIDGETS`)  
  - Files: `admin-frontend/src/index.tsx`  
  - Depends on: 3.1–3.7

---

## Phase 4 — Admin frontend feature lift

- [x] **Task 4.1**: `AdminFilterDrawer` — replace inline filters in `AdminModelTable`  
  - Mobile sheet; testIDs per original spec  
  - Files: `AdminFilterDrawer.tsx`, `AdminModelTable.tsx`, tests  
  - Depends on: 3.2

- [x] **Task 4.2**: Extract `AdminActionMenu` — still uses `bulk-patch` / `background-tasks`  
  - Files: `AdminActionMenu.tsx`, `AdminModelTable.tsx`, tests  
  - Depends on: none (v2 logic move)

- [x] **Task 4.3**: Bulk selection polish — clear on filter/search/sort change (verify v2)  
  - Files: `AdminModelTable.tsx`, tests  
  - Depends on: 4.1

- [x] **Task 4.4**: `sortableFields` + `pageSize` UI enforcement (verify/complete v2)  
  - Files: `AdminModelTable.tsx`, tests  
  - Depends on: 2.7

- [x] **Task 4.5**: `autocompleteFields` async ref picker  
  - Files: `AdminRefField.tsx`, `AdminModelForm.tsx`, tests  
  - Depends on: 3.2

- [x] **Task 4.6**: Static permission UI — hide create/delete/actions when flags false  
  - Files: `AdminModelTable.tsx`, `AdminModelForm.tsx`, `AdminActionMenu.tsx`  
  - Depends on: 2.5, 4.2

---

## Phase 5 — Pre-built admin migrations

- [x] **Task 5.1**: Document plugin widget location (`docs/explanation/admin-plugin-frontend.md`)
  - Decision: widgets live in `admin-frontend/src/widgets/`  
  - Depends on: none

- [x] **Task 5.2**: `FeatureFlagsApp.adminContribution()` + deprecate `featureFlagAdminConfig`
  - Files: `feature-flags/src/featureFlagsApp.ts`, tests  
  - Depends on: 1.4, 2.2

- [x] **Task 5.3**: `FeatureFlagOverridesWidget` in `admin-frontend/src/widgets/`
  - Files: `widgets/FeatureFlagOverridesWidget.tsx`, tests, exports  
  - Depends on: 3.1, 5.2

- [x] **Task 5.4**: `ConsentApp.adminContribution()` + consent field widgets registry
  - Files: consent app, `widgets/consentWidgets.ts`, tests  
  - Depends on: 1.4, 2.2, 3.6

- [x] **Task 5.5**: `DocumentStorageApp.adminContribution()` + `DocumentsScreenWidget`
  - Files: `documentStorageApp.ts`, `widgets/DocumentsScreenWidget.tsx`, tests  
  - Depends on: 1.4, 2.3, 3.3

- [x] **Task 5.6**: `AIAdminApp` plugin + `AIRequestsScreenWidget`
  - Files: `ai/src/aiAdminApp.ts`, `widgets/AIRequestsScreenWidget.tsx`, tests  
  - Depends on: 1.4, 2.3

---

## Phase 6 — Examples, docs, E2E (single atomic PR)

- [x] **Task 6.1**: Audit consent custom screens — `docs/explanation/admin-consent-migration.md`
  - Depends on: 5.4

- [x] **Task 6.2**: **Atomic** migrate `example-backend` — `admin:` on modelRouters, plugins only, one legacy `models[]` entry, `home.slots`
  - Files: `example-backend/src/server.ts`, `api/todos.ts`, `api/users.ts`  
  - Depends on: 5.2, 5.4, 5.5, 5.6

- [x] **Task 6.3**: **Atomic** migrate `example-frontend` + `admin-spa` — `AdminProvider`, `AdminHome`, `AdminScreenRouter`
  - Files: `example-frontend/app/admin/**`, `admin-spa/app/**`  
  - Depends on: 3.8, 5.3, 5.5, 5.6

- [x] **Task 6.4**: How-to: `admin-add-model.md`, `admin-custom-widget.md`, `admin-custom-home.md`, `admin-import-prebuilt.md`
  - Depends on: 6.2, 6.3

- [x] **Task 6.5**: Reference: `docs/reference/admin-config.md`
  - Depends on: 1.1

- [x] **Task 6.6**: Playwright E2E (split by feature file)
  - `admin-home.spec.ts`, `admin-table-search-filter.spec.ts`, `admin-table-bulk-actions.spec.ts`, `admin-form.spec.ts`, `admin-custom-screens.spec.ts`  
  - Depends on: 6.3

---

## Phase 7 — Deprecations & polish

- [ ] **Task 7.1**: Update admin-backend + admin-frontend rule files  
  - Files: `.cursor/rules/admin-*/`, `.claude/rules/admin-*/`

- [ ] **Task 7.2**: MCP `generate_route` emits `admin:` block; optional `generate_admin_widget`  
  - Files: `mcp-server/src/tools.ts`, `prompts.ts`

- [ ] **Task 7.3**: CHANGELOG + minor version bump note  
  - Files: package CHANGELOGs

- [ ] **Task 7.4**: `docs/how-to/admin-migrate.md` for downstream consumers  
  - Depends on: 6.3

- [ ] **Task 7.5**: Structured admin telemetry logs (config size, filter errors, deprecation warnings)  
  - Files: `admin-backend/src/adminApp.ts`, `filterParser.ts`, `legacy.ts`

- [ ] **Task 7.6**: Monorepo compile + lint + test green  
  - Depends on: all

---

## Removed from scope (per decisions)

- ~~`actionRunner.ts` / `POST .../actions/:name`~~ → use v2 `bulk-patch`
- ~~`AdminActionContext` / frozen action context~~ → not needed without custom action runners
- ~~Per-user `/admin/config` permission booleans~~ → static flags; see RBAC IP
- ~~`home.widgets` typed layout~~ → `home.slots` only
