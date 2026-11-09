# Admin UI v2 — Django-Parity Admin (Config-Driven Shell)

**Status:** Implemented (phased tasks complete; acceptance criteria verified in-repo)  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1076
**Branch:** Landed via `cursor/admin-ui-v2-backend-a736` (PR #782)  
**Owner:** Josh Gachnang  
**Created:** 2026-06-15  
**Source:** Claude Design handoff (`Admin UI v2.html`, `admin/v2/schema.jsx`, design transcripts). Design blend plan approved in-session.

**Companion IP — Admin script runner:** Maintenance scripts (`AdminApp` `scripts[]`, `/admin/scripts/*`, `AdminScriptList` / `scriptRunner` widget) are specified in **`docs/implementationPlans/admin-script-runner.md`** with tasks in **`docs/tasks/admin-script-runner.md`**.

## Goal

Evolve Terreno’s admin stack (`@terreno/admin-backend`, `@terreno/admin-frontend`, `@terreno/admin-spa`) so a **single `/admin/config` payload** can drive a **Django-style admin**: grouped sidebar, declarative **home `slots`** (header strip, above-the-fold band, main column, sidebar — analogous to Django admin template blocks), changelist with typed filters / search / sort allowlists / pagination / bulk actions (sync + background), schema-driven forms with fieldsets and readonly enforcement, permission-gated UI (e.g. delete off), and deep links to plugin screens (document storage, AI explorer). **REST-first:** every persisted entity uses `modelRouter` CRUD; only gated custom routes for bulk jobs and config aggregation.

## Non-Goals

- **Pixel-perfect clone** of the HTML prototype’s inline styles — match **behavior and information architecture**, using `@terreno/ui` theming.
- **Replacing Font Awesome in the prototype** — Terreno UI uses FA6 names via `iconName`; map icons at integration boundary.
- **Product-specific Flourish models in core packages** — example models may live in `example-backend`; framework ships **capabilities** and **reference wiring**.
- **SSR / SEO** for admin.
- **Cross-tenant URL structure** — tenant scoping remains consumer-owned via permissions and query filters.

## Decisions

| Question | Decision |
|----------|----------|
| Config contract | Extend `GET /admin/config` with a **versioned** `schemaVersion` (e.g. `2`) and additive fields; preserve v1 consumers until admin-frontend major. |
| List filters | Encode as **queryFields-compatible** filters (booleans, enums, text contains, date ranges, ref id); rail vs chips is **UI mode** only. |
| Bulk sync actions | **`POST {basePath}{routePath}/bulk-patch`** with allowlisted patch keys, **≤ 1000** ids, OpenAPI documented. |
| Background actions | Reuse **`BackgroundTask`** (`@terreno/api`) via **`POST /admin/background-tasks`** (or equivalent under `adminApp`) returning `taskId`; UI uses existing modal patterns (`AdminScriptRunModal` / `Modal` + progress). |
| Autocomplete refs | **No custom search RPC** — `GET` list on referenced model with search query + small limit. |
| Recent actions + audit | **Last phase**: optional **`AdminAuditLog`** model + list endpoint + home widget; **`recentActivity` last within the `sidebar` slot** (see home slots below). |
| Realtime badge | **UI-only** flag from config (`realtime: true`); transport is app-level (polling/socket) out of scope for v1 framework. |
| Home layout | **Slot-based `home.slots` (Solution A)** — mirrors Django admin template regions so tools/scripts can sit **above** the model grid without being “just another card”. See **Django layout mapping** below. |

### Django layout mapping (reference)

Stock Django `admin/index.html` splits the page into template **blocks**, not a flat widget list: main **`content`** is the app/model list (`app_list`); **`sidebar`** is “Recent actions” only; **`nav-global`** in `base.html` is an empty hook used for global shortcuts (e.g. scripts, reports) in the header row. Custom index pages inject markup **before** `app_list` by overriding `index_template` / `{% block content %}`. Terreno encodes the same idea in **`GET /admin/config`** as named **slots**, each an ordered list of **widget ids** resolved by a built-in + plugin registry.

### `home.slots` contract (canonical)

```typescript
// Conceptual shape — exact TypeScript lives in admin-backend / shared types.
home: {
  title: string;
  slots: {
    navGlobal?: string[];   // Django nav-global analogue: compact header strip (e.g. scriptRunner shortcuts)
    contentTop?: string[];  // Django “inject before app_list”: full-width row above model cards
    main?: string[];        // Primary column: modelStats, modelsGrid, plugin widgets, etc.
    sidebar?: string[];     // Django index sidebar: versionConfig, scriptRunner panel, recentActivity, …
  };
};
```

- **`scriptRunner`** (or any custom widget id) in **`navGlobal`** → horizontal tools, never mixed into the model card grid.
- Same id in **`contentTop`** → prominent band **above** `main`.
- **`recentActivity`** belongs in **`sidebar`** when used; it must be **last in `sidebar`** if present (Django keeps recent actions in the sidebar column, below other sidebar content you add).
- Omitted slots render nothing. **`main`** default for backward compat: treat as `["modelsGrid"]` when `schemaVersion >= 2` and `slots` missing but legacy `widgets[]` exists — implementation detail for migration.

## Architecture

```
Browser (admin-spa / embedded admin-frontend)
    │
    ├─ GET /admin/config          ← aggregated model meta + home + screens + scripts
    │
    ├─ CRUD  /admin/{resource}/*  ← modelRouter per registered model (IsAdmin)
    │
    ├─ POST /admin/{resource}/bulk-patch
    │
    └─ POST /admin/background-tasks  → BackgroundTask queue → progress poll/subscribe (app-defined)
```

Plugin screens (**Documents**, **AI requests**) remain **routes owned by** `@terreno/document-storage` / `@terreno/ai`; config only exposes **navigation entries** (`customScreens[]`).

## Models

Domain models in the prototype are **illustrative** (FeatureFlag, CompanyOrganization, DotPhrase, ExternalClinician, HealthEvent, InsurancePlan, ReferralMethod, ReferralSource, UserStatus). Implementations in consumer apps register Mongoose models with `AdminApp`. Framework work ensures **metadata** and **routers** support their shapes:

| Model | Key relations | Indexes / notes |
|-------|----------------|-----------------|
| FeatureFlag | — | Unique `key`; query fields for list/search; hidden `evaluationCache` optional |
| CompanyOrganization | — | Name search |
| ExternalClinician | `organization` → CompanyOrganization | Index `organization` |
| DotPhrase | — | `delete` permission optional **off** |
| Others | — | Standard list/query/sort fields per config |

**AdminAuditLog** (Phase last): `verb`, `modelName`, `recordLabel`, `recordId?`, `actorId`, `created`; list for home widget; optional TTL index for retention.

**BackgroundTask**: use existing `@terreno/api` type used by `AdminApp` / scripts — no new model if already sufficient; document enqueue contract in OpenAPI.

## APIs

### CRUD (per registered model)

- `POST /admin/{resource}` — create  
- `GET /admin/{resource}` — list (pagination, sort, queryFields filters)  
- `GET /admin/{resource}/:id` — read  
- `PATCH /admin/{resource}/:id` — update (strip readonly server-side)  
- `DELETE /admin/{resource}/:id` — delete or **disabled** when permissions say so  

All **`Permissions.IsAdmin`** (or stricter consumer override).

### Custom (Action Decision Gate — approved)

| Endpoint | Purpose |
|----------|---------|
| `GET /admin/config` | **Aggregation** of models, fields, UI hints, scripts, screens, **`home.slots`** (widget ids per region) |
| `POST /admin/{resource}/bulk-patch` | **Command + performance**: multi-row patch, cap ids, single audit hook |
| `POST /admin/background-tasks` | **Command**: enqueue long-running admin job tied to selection |

### Rejected custom routes

| Idea | Fallback |
|------|----------|
| Dedicated ref `/search` RPC | `GET` list + query |
| WebSocket as “admin action” | App transport; REST remains SoT |

## Notifications

- **In-app only:** `@terreno/ui` **Toast** after save, bulk action, enqueue background task, script completion.  
- **No email/push** for admin events in this IP.

## UI

- **Shell:** `Box` / `Page`, grouped sidebar (`Text` section headers, `Button` / `IconButton`, `Avatar`), sticky top bar with breadcrumbs (`Heading`, `Link`).  
- **Home:** Render in order: **`navGlobal` + `contentTop` merged into one horizontal top band** (same flex row, wrapping) → two-column **`main`** + **`sidebar`** (Terreno `Box` / `SplitPage`-style layout). Each slot iterates widget ids from `home.slots`; **`recentActivity` last inside `sidebar`** when present.  
- **List:** `DataTable`, `Pagination`, `TextField` (debounced search), filter rail (`Card` + fields) or chip mode (`SelectField` / date inputs), row selection, bulk `SelectField` + `Modal` confirms, inline boolean via PATCH.  
- **Form:** `Accordion` or stacked `Card` for fieldsets; `TextField`, `NumberField`, `BooleanField`, `SelectField`, `DateTimeField`; readonly fields disabled + helper copy; ref picker = debounced list fetch.  
- **Danger zone:** `Button` destructive + `Modal`; **hidden** when delete permission false.  
- **Background run:** `Modal` + `Spinner` + log `Text` (reuse `AdminScriptRunModal` patterns).  
- **testIDs:** `admin-home`, `admin-home-slot-top` (combined `navGlobal` + `contentTop` widgets), `admin-home-slot-main`, `admin-home-slot-sidebar`, `admin-list-{model}`, `admin-form-{model}`, `filter-{field}`, `bulk-action`, `widget-recent-activity` (last in **sidebar** slot).

## Phases

1. **Backend contracts** — extend config response; bulk-patch; background enqueue; OpenAPI + tests.  
2. **CRUD parity** — ensure each registered model’s `queryFields`, sort, response stripping align with config lists.  
3. **Frontend shell + list + form** — consume v2 config; `DataTable` list; form fieldsets/readonly/autocomplete.  
4. **Home widgets** — registry + **`home.slots`** layout + plugin widget IDs + placement (`navGlobal` and `contentTop` render in one top row; `main` vs `sidebar`).  
5. **admin-spa + example** — runnable demo; link plugin screens.  
6. **Audit log & recent actions (last)** — `AdminAuditLog` model (if approved for deployment), logging hooks, `GET` list, wire **`recentActivity` as the final id in `home.slots.sidebar`**.

### Phase completion (all shipped)

| # | Scope | Evidence |
|---|--------|----------|
| 1 | Config + OpenAPI for `/admin/config` | `admin-backend/src/adminApp.models.test.ts` (`schemaVersion`, `home.slots`, scripts metadata) |
| 2 | Bulk-patch + background-tasks | Same file + `adminApp.test.ts` |
| 3 | Example modelRouter alignment | `example-backend/src/server.ts` registrations |
| 4–6 | Shell, list, form | `admin-frontend` compile + `AdminModelTable.test.tsx`, `AdminModelForm.test.tsx`, `AdminBreadcrumbs.test.tsx` |
| 7 | Home widgets + slots | `admin-frontend/src/AdminHome.test.tsx` |
| 8 | admin-spa + example | `admin-spa/app/**`, Playwright `admin-spa/e2e/**` |
| 9 | Audit + recent activity | `example-backend` `AdminAuditLog` + `onAdminAudit`; `admin-backend` **`AdminApp onAdminAudit`** tests (POST/PATCH/DELETE); `AdminHome.test.tsx` sidebar order |


## Feature Flags & Migrations

- **Config `schemaVersion`:** clients switch parsers/layout when `>= 2`.  
- **No DB migration in framework packages** — consumer apps migrate their own collections.  
- Optional **feature flag** in consumer: `ADMIN_UI_V2` to toggle layout component root (defer if unnecessary).

## Activity Log & User Updates

- **Deferred to final phase** so list/form/config stabilize first.  
- On completion: admin mutations optionally write **AdminAuditLog** rows; home **Recent actions** reads latest N.  
- User-visible copy: past tense verbs (“changed”, “added”, “deleted”) matching prototype semantics.

## Not Included / Future Work

- Full **realtime push** of flag changes to all clients (server fan-out).  
- **Per-field row inline edit** beyond booleans (e.g. numeric inline).  
- **Cross-model global search**.  
- **Export CSV** from changelist.  
- **Granular admin roles** beyond `IsAdmin`.

## Files to Create / Modify (high level)

| Area | Files (expected) |
|------|------------------|
| admin-backend | `src/adminApp.ts` (config shape, bulk route, background enqueue), tests |
| admin-frontend | `AdminModelTable.tsx`, `AdminModelForm.tsx`, new layout/sidebar modules, `useAdminConfig.tsx`, types |
| admin-spa | Router screens for home v2, list v2, form v2; SDK regen |
| api | Only if `BackgroundTask` / OpenAPI helpers need small extensions |
| docs | This IP + `docs/tasks/admin-ui-v2-django-parity.md` |

## Task List

See **`docs/tasks/admin-ui-v2-django-parity.md`** for the executable, phased checklist (audit log / recent actions **last**).

**Script runner tasks** (same release train): **`docs/tasks/admin-script-runner.md`**.

## Acceptance Criteria (summary)

- [x] `GET /admin/config` returns v2 fields without breaking v1 layout (additive + `schemaVersion`).  
- [x] `POST .../bulk-patch` rejects >1000 ids and unknown patch keys.  
- [x] Background enqueue returns task id; admin UI shows progress path consistent with scripts.  
- [x] List: search debounced; filters typed; sort allowlist enforced server-side.  
- [x] Form: readonly fields cannot be persisted via PATCH.  
- [x] Delete UI absent when model `delete` permission disabled.  
- [x] Home: `home.slots` drives layout; `scriptRunner` (or custom tools) in `navGlobal` or `contentTop` never appears inside the **`main`** model grid unless also listed under `main`.  
- [x] Home: when `recentActivity` is configured, it is **last in `slots.sidebar`**.  
- [x] Phase last: audit entries created for configured mutations; recent widget shows data from API.

Verification pointers: `admin-backend/src/adminApp.models.test.ts` (config `schemaVersion`, bulk-patch caps/allowlist, background-tasks, **`AdminApp onAdminAudit`** hooks after POST/PATCH/DELETE), `admin-frontend/src/AdminModelForm.test.tsx` (readonly PATCH body), `admin-frontend/src/AdminHome.test.tsx` (slot/widget placement + sidebar order), `example-backend` admin registration + audit model + OpenAPI snapshot.
