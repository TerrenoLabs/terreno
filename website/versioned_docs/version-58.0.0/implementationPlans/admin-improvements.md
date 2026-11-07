# Implementation Plan: Admin Improvements (post–Admin UI v2)

**Status:** Deferred — roadmap declined #1099; Phase 7 (rules, MCP generator, migration guide, telemetry) not started  
**Branch:** (implementation TBD)  
**Owner:** Josh Gachnang  
**Created:** 2026-06-01 (original); revised 2026-08-20 post–v2 gap analysis  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1099  
**Prerequisite:** [Admin UI v2 — Django-parity admin](./admin-ui-v2-django-parity.md) (**Complete**)  
**Research:** [admin-improvements-research.md](./admin-improvements-research.md)
## Goal

Finish the **architectural** admin overhaul that Admin UI v2 did not ship: co-locate admin config on `modelRouter`, aggregate admins from plugins via `adminContribution()`, introduce `AdminProvider` + a three-bucket widget registry + `AdminScreenRouter`, harden list filters with a strict parser, lift field scrubbing into `@terreno/api`, and migrate pre-built plugin admins — **on top of** the v2 shell, `home.slots`, `bulk-patch`, and script runner already in production.

## Non-Goals

- Replacing Admin UI v2 UX that already works (shell, slots layout, bulk-patch, background tasks, audit log, scripts).
- `POST /admin/{resource}/actions/:name` or imperative `AdminAction.run()` handlers — **bulk actions stay on v2** (`bulk-patch` + declarative `patchKeys`, `background: true` → `/admin/background-tasks`).
- Per-user permission evaluation on `/admin/config` — defer to [RBAC permissions](./rbac-permissions.md); v2 static `permissions.{create,update,delete}` flags remain.
- `home.widgets` typed array — canonical layout is v2 **`home.slots`** only.
- Socket.io server / realtime UI push (event bus API surface only).
- True related-model inlines, `date_hierarchy`, `prepopulated_fields`, `list_editable`, `show_facets`.

## Decisions

| Question | Decision |
|----------|----------|
| Delivery scope | **Full IP** (provider, screen router, filter drawer, filterParser, plugin migrations, docs, E2E) — not architecture-only |
| Bulk actions API | **v2 only** — `bulk-patch` + `background-tasks`; no `/actions/:name` |
| Home layout | **`home.slots`** (`navGlobal`, `contentTop`, `main`, `sidebar`); plugin widgets by string id in slots |
| `/admin/config` permissions | **Static flags** (v2) — not evaluated per requesting user |
| Filter hardening | **`filterParser`** module with injection tests; **keep v2 query param shape** where compatible |
| Plugin frontend widgets | **`admin-frontend/src/widgets/`** (option A) |
| Example migration | **Single atomic PR** — backend + frontend + admin-spa together |
| Roadmap | **New tracking issue** (not extending admin-ui-v2 issue) |
| Field names | **No renames** — `listFields`, `defaultSort`, etc. stay; additive options only |
| TerrenoPlugin signature | Extend `register(app, openApi?, terrenoApp?)` additively; `TerrenoApp.build()` passes `this` |
| Collision precedence | Registered `modelRouter` with `admin:` **>** plugin `adminContribution()` **>** legacy `AdminApp.models` |
| Widget registry shape | `{ fields, home, screens }` — locked before implementation |

### Already shipped (Admin UI v2 — out of scope for re-implementation)

Treat as baseline; extend, do not rewrite:

- `schemaVersion: 2`, extended model meta, `home.slots`, `customScreens`, `scripts`
- `POST .../bulk-patch`, `POST /admin/background-tasks`, script runner routes
- `AdminShell`, `AdminHome` (built-in widget ids), `AdminModelTable` (search, inline filters, bulk select, declarative actions), `AdminModelForm` (fieldsets, readonly PATCH strip)
- `AdminAuditLog` + `recentActivity` widget, `admin-spa` + example v2 wiring

## Architecture

```
@terreno/api
  modelRouter(..., { admin?: AdminConfig })
  TerrenoApp.getRegistrations() / getPlugins()
  TerrenoPlugin.adminContribution?()
  scrubAdminFields() — shared exclude/hidden + populated recursion
  TerrenoApp.on/off/emit("admin:model.changed") — no transport

@terreno/admin-backend
  AdminApp.register() aggregates:
    1. modelRouter registrations with admin:
    2. plugin adminContribution()
    3. legacy AdminApp.models[] (deprecated, one release)
  filterParser.ts — strict validation on declared filters
  /admin/config — + widgetIds, capabilities (additive)

@terreno/admin-frontend
  AdminProvider { api, baseUrl, widgets: { fields, home, screens } }
  AdminScreenRouter — custom screen vs model table
  AdminHome — slots + registry (refactor existing)
  AdminFilterDrawer — replaces inline filter rail
  widgets/* — built-ins + plugin widgets (FeatureFlagOverrides, Documents, AI, consent field widgets)
```

## Models

No new framework models. Consumers keep domain models; optional `AdminAuditLog` remains example-only (v2).

## APIs

### Unchanged (v2 — keep)

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/config` | Aggregated metadata + `home.slots` + scripts + screens |
| CRUD `/admin/{resource}/*` | Per-model admin routes |
| `POST /admin/{resource}/bulk-patch` | Sync bulk patch (`ids`, `patch`); ≤1000 ids |
| `POST /admin/background-tasks` | Background bulk / long jobs |
| `POST /admin/scripts/:name/run` | Curated maintenance scripts |

### New / extended

| Surface | Change |
|---------|--------|
| `modelRouter` options | Optional `admin: AdminConfig` (types in `@terreno/api`) |
| `TerrenoPlugin` | Optional `adminContribution(): AdminContribution` |
| List queries | `filterParser` validates declared `filters[]` before merge into Mongoose query (same wire shape as v2 `queryFields`) |
| `TerrenoApp` | `admin:model.changed` emit when `admin.realtime === true` (scrubbed payload) |

### Explicitly rejected

- `POST /admin/{resource}/actions/:name` — use `bulk-patch` / `background-tasks` instead.

## Notifications

In-app **Toast** only (v2). No email/push for admin events.

## UI

- **Shell:** Keep v2 `AdminShell` / `AdminShellLayout`.
- **Home:** Keep **`home.slots`**; resolve widget ids via `AdminProvider.widgets.home` + built-ins in `widgets/`.
- **List:** Extract **filter drawer** (`AdminFilterDrawer`); keep v2 search debounce and bulk UI (refactor to `AdminActionMenu` component, still calling `bulk-patch`).
- **Form:** Field widgets from `AdminProvider.widgets.fields`; `autocompleteFields` async ref search via list endpoint.
- **Screens:** `AdminScreenRouter` + `widgets.screens` for Documents, AI explorer, consent custom flows.
- **testIDs:** Preserve v2 ids; add drawer/menu ids from original task spec.

## Phases

### Phase 0 — Baseline (complete)

Admin UI v2. See [admin-ui-v2-django-parity.md](./admin-ui-v2-django-parity.md).

### Phase 1 — Core API surface (`@terreno/api`)

`adminTypes.ts`, `admin` on `modelRouter`, plugin + TerrenoApp extensions, `scrubAdminFields`, event bus, `excludeFields` / `readonlyFields` enforcement at router layer where applicable.

### Phase 2 — Admin backend aggregation

Rewrite `AdminApp` discovery; `legacy.ts`; `filterParser.ts`; `widgetIds` + `capabilities` on config; `adminFilter` async merge into list queries.

### Phase 3 — Admin frontend foundations

`AdminProvider`, registry, `AdminScreenRouter`, refactor `AdminHome` to use registry, extract widgets to `widgets/`.

### Phase 4 — Admin frontend feature lift

`AdminFilterDrawer`, `AdminActionMenu` (bulk-patch), field widgets from context, `autocompleteFields`, permission-gated UI (static flags).

### Phase 5 — Pre-built admin migrations

`FeatureFlagsApp`, `ConsentApp`, `DocumentStorageApp`, `AIAdminApp` → `adminContribution()` + frontend widgets in `admin-frontend/src/widgets/`.

### Phase 6 — Examples, docs, E2E (atomic)

Single PR: `example-backend` + `example-frontend` + `admin-spa`; four how-to docs + `admin-config` reference; Playwright specs.

### Phase 7 — Deprecations & polish

Legacy warnings, rule files, MCP `generate_route`, CHANGELOG.

## Feature Flags & Migrations

- **No breaking config version bump** — stay on `schemaVersion: 2`; additive fields only.
- `AdminApp.models[]` deprecated one minor cycle with one-time warning per entry.
- `AdminModelList` `customScreens` prop deprecated when `AdminProvider` is used.

## Activity Log & User Updates

Covered by v2 `AdminAuditLog` + `recentActivity`. No changes unless aggregation hooks need audit labels for plugin-registered models.

## Not Included / Future Work

- Per-user `/admin/config` permission booleans ([rbac-permissions](./rbac-permissions.md)).
- Custom `AdminAction.run()` / `/actions/:name`.
- Socket.io fan-out of `admin:model.changed`.
- `home.widgets` alternate layout API.
- Cross-model global search, CSV export, granular admin roles beyond `IsAdmin`.

## Files to Create / Modify (summary)

| Area | Key files |
|------|-----------|
| api | `adminTypes.ts`, `scrubAdminFields.ts`, `terrenoApp.ts`, `terrenoPlugin.ts`, `api.ts` |
| admin-backend | `adminApp.ts`, `legacy.ts`, `filterParser.ts`, tests |
| admin-frontend | `AdminProvider.tsx`, `AdminScreenRouter.tsx`, `AdminFilterDrawer.tsx`, `AdminActionMenu.tsx`, `widgets/*`, refactor `AdminHome.tsx` |
| plugins | `feature-flags`, consent, `documentStorageApp`, `ai/src/aiAdminApp.ts` |
| examples | `example-backend/src/server.ts`, `example-frontend/app/admin/**`, `admin-spa/**` |
| docs | `docs/how-to/admin-*.md`, `docs/reference/admin-config.md` |

## Task List

See **[docs/tasks/admin-improvements.md](../tasks/admin-improvements.md)**.

## Acceptance Criteria

- [ ] `admin: { ... }` on a `modelRouter` appears in `/admin/config` without duplicating entry in `AdminApp.models`.
- [ ] `new FeatureFlagsApp()` registered on `TerrenoApp` auto-registers FeatureFlag admin; `"feature-flags-overrides"` in `home.slots` renders when listed.
- [ ] `filterParser` rejects operator injection and prototype-pollution; compatible v2 list URLs still work.
- [ ] Bulk select + action uses **`bulk-patch`** or **background-tasks** (not `/actions/:name`).
- [ ] `AdminProvider` + `AdminScreenRouter` replace example-frontend string-switch; Documents + AI screens work via registry.
- [ ] `AdminFilterDrawer` replaces inline filter rail; mobile sheet behavior preserved.
- [ ] `excludeFields` / `hiddenFields` scrub populated refs using referenced model's admin config.
- [ ] `admin.realtime: true` emits scrubbed `admin:model.changed` (unit test); no socket server started.
- [ ] Legacy `AdminApp.models[]` works with one deprecation warning per entry.
- [ ] Atomic example migration: backend boots, admin-spa + example-frontend admin E2E green.
- [ ] How-to + reference docs published; types exported from `@terreno/api`, `@terreno/admin-backend`, `@terreno/admin-frontend`.

## Risks

| Risk | Mitigation |
|------|------------|
| Duplicating v2 work | Phase 0 checklist; tasks mark v2 items complete; refactor don't rewrite |
| `TerrenoApp` ↔ `AdminApp` wiring | Third `terrenoApp` arg on `register`; `_buildWithContext` internal rename |
| routePath collisions | Throw on duplicate registered routers; warn on plugin vs legacy |
| Filter parser breaks existing URLs | Parser accepts v2 shapes; tests include v2 example-backend filter queries |
| Atomic example PR size | Single PR still split into logical commits inside the PR |
| Widget bundle size | Consumers pass only widgets they import at `AdminProvider` construction |
