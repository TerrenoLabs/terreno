# Research: Admin Improvements (post–Admin UI v2 gap)

**Date:** 2026-08-20  
**PRD:** Implement what did not ship in Admin UI v2 — finish the `admin-improvements` architectural overhaul on top of the landed `admin-ui-v2-django-parity` work.

## Scope investigated

- Existing IPs: `docs/implementationPlans/admin-improvements.md`, `docs/implementationPlans/admin-ui-v2-django-parity.md`, `docs/tasks/admin-improvements.md`, `docs/tasks/admin-ui-v2-django-parity.md`
- Packages: `api/`, `admin-backend/`, `admin-frontend/`, `admin-spa/`, `feature-flags/`, `example-backend/`, `example-frontend/`
- Roadmap: `.github/roadmap-fields.yml` present → roadmap handoff applies after IP approval

## What Admin UI v2 already shipped

`admin-ui-v2-django-parity` is marked **Implemented** with all task phases complete. Evidence in-repo:

| Area | Shipped |
|------|---------|
| Config | `schemaVersion: 2`, extended model meta, `home.slots` (`navGlobal`, `contentTop`, `main`, `sidebar`) |
| Backend routes | `POST .../bulk-patch` (≤1000 ids), `POST /admin/background-tasks` |
| Scripts | `/admin/scripts/*`, `scripts[]` in config (see `admin-script-runner.md`) |
| Shell / home | `AdminShell`, `AdminHome` with built-in widget ids (`modelsGrid`, `scriptRunner`, `recentActivity`, `versionConfig`, …) |
| List | `AdminModelTable`: debounced search, inline typed filters, row select, declarative `actions` → bulk-patch or background enqueue |
| Form | `AdminModelForm`: fieldsets, readonly (server strips PATCH body) |
| Audit | `AdminAuditLog` + `onAdminAudit` + `recentActivity` widget (sidebar, last) |
| Integration | `admin-spa`, `example-backend` v2 demo registrations, Playwright e2e |

## What `admin-improvements` planned but did NOT ship

All tasks in `docs/tasks/admin-improvements.md` remain **unchecked**. High-level gaps:

### `@terreno/api` (Phase 1) — none landed

- No `api/src/adminTypes.ts` (`AdminConfig`, `AdminContribution`, `AdminAction`, …)
- No `admin?: AdminConfig` on `ModelRouterOptions`
- `TerrenoPlugin.register` still `(app, openApi?)` — no `terrenoApp` third arg
- No `getRegistrations()` / `getPlugins()` on `TerrenoApp`
- No `adminContribution?()` on `TerrenoPlugin`
- No typed `admin:model.changed` event bus on `TerrenoApp`
- No shared `scrubAdminFields` with populated-doc recursion
- `readonlyFields` / `excludeFields` enforcement lives in `admin-backend` only, not in `modelRouter` hooks

### `@terreno/admin-backend` (Phase 2) — partial overlap with v2, architecture gap remains

| Planned | Status |
|---------|--------|
| Aggregate admin from modelRouter `admin:` + plugin contributions + legacy `models[]` | **Not done** — still `AdminApp({ models: [...] })` only |
| `legacy.ts` adapter + deprecation warnings | **Not done** |
| `filterParser.ts` (strict per-type `filter[k]=v`) | **Not done** — list uses `queryFields`-compatible filters directly |
| `actionRunner.ts` + `POST .../actions/:name` + frozen `AdminActionContext` | **Not done** — v2 uses `bulk-patch` + `background-tasks` with `patchKeys` |
| Per-user permission booleans in `/admin/config` | **Partial** — `permissions` are static config flags (`create/update/delete !== false`), not evaluated per requesting user |
| `adminFilter` async row scoping | **Not done** (only `queryFilter` on `AdminModelConfig`) |
| `capabilities`, `widgetIds` top-level config | **Not done** |
| `Cache-Control: private, no-store` on config | **Not verified** |

### `@terreno/admin-frontend` (Phases 3–4) — v2 UI exists, provider/registry pattern missing

| Planned | Status |
|---------|--------|
| `AdminProvider` + three-bucket widget registry (`fields`, `home`, `screens`) | **Not done** |
| `AdminScreenRouter` | **Not done** — `example-frontend` still uses string-switch in `[model]/index.tsx` |
| Widget modules under `widgets/` | **Not done** — widgets inline in `AdminHome.tsx` |
| `AdminFilterDrawer` (right rail / mobile sheet) | **Not done** — filters inline in `AdminModelTable` |
| `AdminActionMenu` component | **Not done** — bulk UI inline in table |
| `AdminFieldRenderer` reads widgets from context | **Not done** — hardcoded switch |
| Plugin home widgets via registry (`feature-flags-overrides`) | **Warn-only** in `AdminHome` — no injectable component |

### Pre-built plugin migrations (Phase 5) — not started

- `FeatureFlagsApp.adminContribution()` — still exports `featureFlagAdminConfig` passed manually in `example-backend`
- `ConsentApp.adminContribution()` — consent admins wired manually in server
- `DocumentStorageApp` / AI explorer — custom screens hand-rolled in example-frontend (`ADMIN_CUSTOM_SCREENS`, `AIAdminScreen`)

### Docs / examples (Phase 6–7) — not started

- No `docs/how-to/admin-*.md` or `docs/reference/admin-config.md`
- Example apps not migrated to `admin:` on modelRouter / `AdminProvider` / `AdminScreenRouter`
- MCP `generate_route` still emits legacy patterns

## Contract tensions (v2 vs original admin-improvements IP)

These need product decisions before rewriting the IP:

1. **Bulk actions API**
   - **v2:** declarative `actions[]` with `patchKeys` → `POST .../bulk-patch` or `background-tasks`
   - **admin-improvements:** imperative `AdminAction.run(ctx)` → `POST .../actions/:name`
   - Both can coexist or one can subsume the other.

2. **Home layout config**
   - **v2:** `home.slots` (Django template regions) with string widget ids
   - **admin-improvements:** `home.widgets` array of typed specs (`{type:"modelStats"}`, plugin id strings, React components)
   - Shipped contract is `slots`; IP must align to v2 unless breaking.

3. **Filter wire format**
   - **v2:** filters map to existing `queryFields` query params (kind-specific UI in table)
   - **admin-improvements:** strict `filter[field]=value` parser module with injection hardening
   - May be additive hardening on top of v2, or a new encoding.

4. **Config field names**
   - **v2:** kept `listFields`, `defaultSort`
   - **admin-improvements:** originally considered `listDisplay` / `ordering` aliases — v2 added `listDisplay` alongside `listFields` in model meta

5. **Per-user `/admin/config`**
   - **admin-improvements:** evaluate permissions per request (uncacheable)
   - **v2:** static permission flags on model config

## Candidate delivery options (not chosen — for Step 3)

| Option | Scope | Tradeoff |
|--------|-------|----------|
| **A. Architecture-only** | Phases 1–2 + 5 + 6 (api types, aggregation, plugin contributions, docs); keep v2 UI/components as-is | Fastest path to “admin on modelRouter”; least UI churn |
| **B. Full original IP** | All phases including AdminProvider, ScreenRouter, filterParser, `/actions/:name`, drawer, docs, E2E | Largest diff; some v2 work duplicated or replaced |
| **C. Incremental slices** | Ship A first, then provider/registry (Phase 3), then optional hardening (filterParser, per-user config) | Lower risk; longer calendar time |

## Decisions recorded (2026-08-20)

| # | Choice |
|---|--------|
| 1 | **B** — Full IP (provider, screen router, drawer, filterParser, plugins, docs, E2E) |
| 2 | **A** — Bulk actions: v2 `bulk-patch` only; no `/actions/:name` |
| 3 | **A** — `home.slots` canonical |
| 4 | **B** — Static permission flags on config |
| 5 | **A** — `filterParser` with v2-compatible wire shape |
| 6 | **A** — Plugin widgets in `admin-frontend/src/widgets/` |
| 7 | **A** — Atomic example-backend + frontend + admin-spa migration |
| 8 | **B** — New roadmap tracking issue |

IP and task list updated: `admin-improvements.md`, `docs/tasks/admin-improvements.md`.

## References

- `docs/implementationPlans/admin-improvements.md` — original full IP (pre–v2)
- `docs/implementationPlans/admin-ui-v2-django-parity.md` — shipped v2 IP
- `docs/tasks/admin-improvements.md` — unchecked task list
- `example-backend/src/server.ts` — still uses `AdminApp({ models: [featureFlagAdminConfig, …] })`
- `example-frontend/app/admin/[model]/index.tsx` — manual screen routing
- `admin-frontend/src/AdminHome.tsx` — inline widgets, no `AdminProvider`
