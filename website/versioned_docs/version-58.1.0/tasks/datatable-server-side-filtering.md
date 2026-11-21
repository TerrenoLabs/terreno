# Tasks: DataTable server-side filtering and search

Plan: [`docs/implementationPlans/datatable-server-side-filtering.md`](../implementationPlans/datatable-server-side-filtering.md)  
**Status:** Pick complete — tasks 1.1–4.1 implemented
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1177

**Feature profile:** false (full IP)

## Instructions for the implementing agent

- Load `terreno-ui`, `update-docs`, `verify-ui-changes`. Admin tasks also load `building-admin-interfaces`.
- TDD: failing test first per task.
- Run `bun test` in touched packages (`ui`, `admin-frontend`, `admin-backend`).
- Do not import RTK, axios, or admin packages from `@terreno/ui`.
- Do not change modelRouter list behavior or admin `q` ObjectId search.
- Frontend slices: `verify-ui-changes` (demo on 8085; admin list when AdminModelTable changes).

---

### Phase 1 — Tracer (query object, no chrome)

- [x] **Task 1.1**: `buildDataTableListQuery` + regex escape
  - Delivers: Pure helper from filter/search state → modelRouter-shaped object per the IP contract table; empty values omitted; user text escaped; choice always `$in` (including one value)
  - Files: `ui/src/dataTableListQuery.ts`, `ui/src/dataTableListQuery.test.ts`, export from `ui/src/index.tsx` only if other UI modules need it (prefer importing the file, no new barrel)
  - Blocked by: none
  - Skills: `terreno-ui`, `update-docs`
  - Docs: stub the query table in `docs/reference/ui.md` so the helper is named when it lands
  - Acceptance: `bun test ui/src/dataTableListQuery.test.ts` — search `$or` regex; `.*` in input is literal; boolean omit/true; date `_gte`/`_lte`; number nested `$gte`; choice `$in`; no `page`/`sort` keys

---

### Phase 2 — DataTable chrome

- [x] **Task 2.1**: Types + controlled props
  - Delivers: `DataTableColumn.filter` and search/filter/`onQueryChange` props; omitted props preserve today’s UI
  - Files: `ui/src/Common.ts`, `ui/src/DataTable.tsx`, `ui/src/DataTable.test.tsx`
  - Blocked by: 1.1
  - Skills: `terreno-ui`
  - Docs: none beyond types (generated props in 4.1)
  - Acceptance: tests — no filter prop → no filter controls; `onQueryChange` not required; existing sort cycle and pagination tests still pass

- [x] **Task 2.2**: Web per-column `Filter` + search box
  - Delivers: Toolbar search (debounced) and header `Filter` popovers; text / boolean / numberRange / dateRange / choice (`MultiselectField`); `renderFilter` slot; Apply/Clear call `onFilterValuesChange` and `onQueryChange`
  - Files: `ui/src/DataTable.tsx`, `ui/src/DataTable.test.tsx`, `demo/stories/DataTable.stories.tsx`
  - Blocked by: 2.1
  - Skills: `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: demo story is the tutorial surface; reference example in `docs/reference/ui.md`
  - Acceptance: tests fire `onQueryChange` for each kind; demo story renders search + four kinds; `verify-ui-changes` on demo DataTable story

- [x] **Task 2.3**: Native Filters sheet
  - Delivers: On non-web, one Filters control + `Modal` sheet containing the same fields and search; same query object as web
  - Files: `ui/src/DataTable.tsx`, `ui/src/DataTable.test.tsx`
  - Blocked by: 2.2
  - Skills: `terreno-ui`
  - Docs: one row in the platform table in `docs/reference/ui.md`
  - Acceptance: test with `Platform.OS` mock (or testIDs) — sheet apply emits the same params as web Apply; no `Filter` portal on native

---

### Phase 3 — Admin

- [x] **Task 3.1**: `parseAdminListFilters` choice `$in` and text `$regex`
  - Delivers: Declared `choice` accepts `{ $in: string[] }` (subset of `choices`); `text` accepts `{ $regex, $options: "i" }`; scalar choice/text still work; top-level `$or` still errors; values outside `choices` error
  - Files: `admin-backend/src/filterParser.ts`, `admin-backend/src/filterParser.test.ts`
  - Blocked by: none (can parallel 2.x)
  - Skills: `building-admin-interfaces`
  - Docs: note in `docs/how-to/admin-add-model.md` that choice filters may be multi-value `$in`
  - Acceptance: `bun test admin-backend/src/filterParser.test.ts` covers happy `$in`, invalid choice, text regex, rejected `$or`

- [x] **Task 3.2**: AdminModelTable adopts DataTable filters
  - Delivers: Map `filters` → column `filter` / `renderFilter` for `ref`; search → `q`; drop `AdminFilterDrawer` from the table; `buildAdminListQueryParams` forwards `$in` and omits `$or`
  - Files: `admin-frontend/src/AdminModelTable.tsx`, `admin-frontend/src/adminModelListQueryParams.ts`, `admin-frontend/src/adminModelListQueryParams.test.ts`, `admin-frontend/src/AdminModelTable.test.tsx`, `admin-frontend/src/AdminFilterDrawer.tsx` / `index.tsx` if unused
  - Blocked by: 2.2, 3.1
  - Skills: `building-admin-interfaces`, `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: `docs/reference/admin-frontend.md`, `docs/explanation/admin-interface.md`, `docs/how-to/admin-add-model.md` (filters on columns, not a drawer)
  - Acceptance: tests — search param is `q` not `$or`; choice multi → `$in`; drawer not in table output; admin list verification in admin-spa or example admin

---

### Phase 4 — Docs and seed

- [x] **Task 4.1**: Diátaxis + generated props + changelog
  - Delivers: Query contract and platform table in `docs/reference/ui.md`; admin how-to/reference/explanation; regenerate UI component reference; CHANGELOG Added; seed IP/task links already in Grow stay accurate
  - Files: `docs/reference/ui.md`, `docs/how-to/admin-add-model.md`, `docs/reference/admin-frontend.md`, `docs/explanation/admin-interface.md`, `docs/explanation/roadmap-seed-issues.md`, `CHANGELOG.md`; `ui` types + `bun run website:generate` as required by `update-docs`
  - Blocked by: 2.3, 3.2
  - Skills: `update-docs`
  - Acceptance: a stranger can wire `onQueryChange` to a modelRouter list from docs; admin text contains + choice `$in` are explicit; `bun run website:build` if the site is in the slice
