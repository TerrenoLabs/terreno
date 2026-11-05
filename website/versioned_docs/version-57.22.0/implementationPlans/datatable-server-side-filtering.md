# Implementation Plan: DataTable server-side filtering and search

**Status:** Complete — shipped in #1303  
**Branch:** `cursor/datatable-server-side-filtering-191d`  
**Owner:** —  
**Created:** 2026-09-10  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1177 (this feature **closes** that issue; implementation PRs use `Fixes #1177`)  
**Task list:** [datatable-server-side-filtering.md](../tasks/datatable-server-side-filtering.md)  
**Depends on:** —  
**RTK deprecation flag:** Partial — `@terreno/ui` stays data-layer agnostic; AdminModelTable keeps RTK `useListQuery`; syncdb is out of scope  

## Goal

`DataTable` grows optional, controlled filter and search chrome that emits a JavaScript object of [modelRouter](../how-to/create-a-model.md) list params (`queryFields` equality, nested `$in` / `$regex` / `$gte`/`$lte`, date `field_gte`/`field_lte`, search `$or`). Parents pass that object to RTK, `fetch`, or any client. `AdminModelTable` uses the same UI and drops `AdminFilterDrawer`.

## Non-Goals

- Changing modelRouter list semantics or adding a new list query language.
- Changing admin `q` / `buildAdminPartialSearchFilter` (ObjectId match stays on the backend).
- Client-side filtering of the `data` prop.
- Nested `$and`/`$or` query-builder UI.
- Multi-select `$in` on admin `ref` (single ObjectId only).
- Syncdb `useQuery` list wiring.
- Making `Filter` itself universal (native uses a `Modal` sheet).

## Decisions

| Question | Decision |
|----------|----------|
| Emission | Presentational `onQueryChange(params)` JS object. Page/sort stay the existing callbacks. Parent merges. |
| Operators | Text contains (`$regex` + `$options: "i"`, escaped); boolean equality; date `field_gte`/`field_lte`; number `{field: {$gte,$lte}}`; choice multi-select `{field: {$in: values}}`. |
| Search | Generic: `$or` of escaped `$regex` on caller `searchFields`. Admin: toolbar string → `q` only (do not send `$or`; parser rejects top-level operators). |
| Admin chrome | One surface: DataTable search + column filters. Remove `AdminFilterDrawer`. `ref` uses column `renderFilter`. |
| Native | One “Filters” `Modal`/`ActionSheet` with every column filter + search. Web: per-column `Filter` popovers. |
| Control | Filter/search state is controlled like `page` / `sortColumn`. Search debounce matches admin (existing delay). |
| Admin parser | Extend `parseAdminListFilters` for choice `$in` (allowed values only) and text `{ $regex, $options: "i" }`. Keep rejecting undeclared `$or`. |

## Architecture

```
DataTable (optional filter/search props)
  web: header Filter popover per filterable column
  native: one Filters sheet
  → buildDataTableListQuery(state) → onQueryChange(params)

Parent
  generic modelRouter: pass params to list GET (qs.stringify nested ops)
  AdminModelTable: strip $or; set q from search; keep $in / ranges / equality; RTK useListQuery
```

`@terreno/ui` must not import RTK, admin, or axios. Export `buildDataTableListQuery` and filter types next to DataTable.

### Public types (sketch)

```typescript
interface DataTableColumnFilterChoiceOption {
  label: string;
  value: string;
}

interface DataTableColumnFilter {
  field: string;
  kind: "text" | "boolean" | "numberRange" | "dateRange" | "choice";
  options?: DataTableColumnFilterChoiceOption[]; // choice
  renderFilter?: (args: {
    field: string;
    value: unknown;
    onChange: (value: unknown) => void;
  }) => React.ReactNode;
}

interface DataTableQueryParams {
  [field: string]: unknown;
  $or?: Array<Record<string, unknown>>;
}

interface DataTableProps {
  // existing page / sort / data ...
  search?: string;
  searchFields?: string[];
  onSearchChange?: (search: string) => void;
  filterValues?: Record<string, unknown>;
  onFilterValuesChange?: (next: Record<string, unknown>) => void;
  onQueryChange?: (params: DataTableQueryParams) => void;
}
```

`DataTableColumn` gains optional `filter?: DataTableColumnFilter`. Omit `filter` → no column control (today’s table). Omit search props → no search box.

`onQueryChange` fires when search (debounced) or filters change. It does **not** include `page`, `limit`, or `sort`.

### Query object contract

| UI | Wire |
|----|------|
| Search (generic) | `$or: [{field: {$regex: escaped, $options: "i"}}, ...]` for `searchFields` |
| Text column | `{field: {$regex: escaped, $options: "i"}}` |
| Boolean | `{field: true \| false}`; unset omits the key |
| Date range | `field_gte` / `field_lte` ISO strings (modelRouter Date merge) |
| Number range | `{field: {$gte?: number, $lte?: number}}` |
| Choice (one or many) | `{field: {$in: string[]}}` even for a single value |
| Empty filter | key omitted |

Escape every user regex with the same rules as `escapeRegexLiteral` in `admin-backend/src/adminTextSearch.ts` (copy into ui; do not import admin-backend).

### Native vs web

| Platform | Chrome |
|----------|--------|
| Web | Toolbar `TextField` search; per-column header icon opens existing `Filter` (Apply/Clear). Choice uses `MultiselectField`. |
| Native | Toolbar search + one “Filters” control opening `Modal` (or existing mobile sheet pattern from admin: `ADMIN_FILTER_MOBILE_BREAKPOINT`). Same `filterValues` / `onQueryChange`. |

### Admin adoption

`AdminModelTable` maps `modelConfig.filters` onto `DataTableColumn.filter`:

| Admin kind | DataTable kind |
|------------|----------------|
| `text` | `text` (contains; documented behavior change from exact match) |
| `boolean` | `boolean` |
| `dateRange` | `dateRange` |
| `choice` | `choice` + `options` from `choices` |
| `ref` | `choice`-shaped slot with `renderFilter` wrapping `AdminRefField` (single id) |

`buildAdminListQueryParams` consumes DataTable state:

1. Copy filter params except `$or`.
2. If `searchFields.length && search.trim()`, set `q`.
3. Keep `limit`, `page`, `sort`.

Delete `AdminFilterDrawer` usage from the table. Keep the module only if another screen still imports it; otherwise remove export after table tests prove the new path.

`parseAdminListFilters` today rejects objects on choice/text and any top-level `$` key. This slice:

- Parses `role: { $in: ["staff", "admin"] }` when every value is in `choices`.
- Parses text `{ $regex: string, $options: "i" }` (regex already escaped by the client).
- Still errors on top-level `$or` / `$and`.

### Compatibility

Existing `DataTable` callers with no filter/search props are unchanged (no chrome, no callbacks).

## Models

None.

## APIs

No new HTTP routes. Consumers keep `GET` list with existing `queryFields`. Admin list still uses `q` for search.

## Notifications

None.

## UI

Demo story: filterable columns + search, mock `onQueryChange` log / JSON. Admin SPA / example admin: Todos or Users list — search, boolean, choice `$in`, date range, ref via custom renderer.

## Phases

1. **Tracer:** query helper + DataTable tests (no fetch).
2. **Chrome:** web popovers + native sheet + demo story.
3. **Admin parser + table:** `$in` / text regex; drop drawer.
4. **Docs:** reference, how-to, seed links, generated component props.

## Feature Flags & Migrations

No flag. Admin text filters become contains. Call out in CHANGELOG and admin how-to.

## Activity Log & User Updates

- 2026-09-10: Grow approved; next Pick Task 1.1.

## Not Included / Future Work

- Multi-select `$in` on `ref`.
- Client-side filter of `data`.
- Nested boolean query builder.
- Universal `Filter` popover on native.
- Syncdb collection queries.

## Files to Create / Modify

| Path | Change |
|------|--------|
| `ui/src/Common.ts` | Filter types on `DataTableColumn` / `DataTableProps` |
| `ui/src/dataTableListQuery.ts` (new) | `buildDataTableListQuery`, regex escape |
| `ui/src/DataTable.tsx` | Search + column filters + native sheet |
| `ui/src/DataTable.test.tsx` | Query emission tests |
| `demo/stories/DataTable.stories.tsx` | Filter/search demo |
| `admin-backend/src/filterParser.ts` | Choice `$in`, text `$regex` |
| `admin-backend/src/filterParser.test.ts` | New cases |
| `admin-frontend/src/AdminModelTable.tsx` | Wire DataTable; remove drawer |
| `admin-frontend/src/adminModelListQueryParams.ts` | Map search → `q`; pass `$in` |
| `admin-frontend/src/AdminFilterDrawer.tsx` | Remove if unused |
| `docs/reference/ui.md` | DataTable filter contract |
| `docs/how-to/admin-add-model.md` | Filters live on the table; text is contains |
| `docs/reference/admin-frontend.md` | AdminModelTable |
| `docs/explanation/admin-interface.md` | Drop drawer as the list filter UI |
| `docs/explanation/roadmap-seed-issues.md` | IP/task links |
| `CHANGELOG.md` | Added |

Generated `docs/reference/components/` DataTable props via `ui` `bun run types` / `website:generate` in the docs task.

## Task List

[datatable-server-side-filtering.md](../tasks/datatable-server-side-filtering.md)

## Acceptance Criteria

- [ ] DataTable with no filter/search props matches current sort/page-only UI (unit test).
- [ ] `buildDataTableListQuery` emits escaped `$regex` `$or` for search and `{field: {$in}}` for multi choice (`bun test ui/src/dataTableListQuery.test.ts` or colocated).
- [ ] Interacting with web column Filter Apply calls `onQueryChange` with the contract table (`DataTable.test.tsx`).
- [ ] Native “Filters” sheet applies the same object (`DataTable.test.tsx` with platform mock or sheet testIDs).
- [ ] Admin list: search still hits `q`; choice multi-select reaches Mongo `$in`; `parseAdminListFilters` rejects top-level `$or` (`filterParser.test.ts` + `AdminModelTable.test.tsx`).
- [ ] `AdminFilterDrawer` is not rendered on `AdminModelTable`.
- [ ] Demo story shows search + at least text, boolean, date, and choice filters.
- [ ] Docs: `docs/reference/ui.md`, admin how-to/reference, generated component props, CHANGELOG.
- [ ] `bun run analyze:full` clean; frontend verification per `verify-ui-changes` (demo + admin list).
