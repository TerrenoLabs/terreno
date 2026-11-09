# Tasks: Dashboard chart parity

IP: [dashboard-chart-parity.md](../implementationPlans/dashboard-chart-parity.md)  
**Follows:** https://github.com/TerrenoLabs/terreno/issues/1175  
**Roadmap issue:** set after IP approval

**Feature profile:** false (full IP)

## Phase 1 — Tracer (scorecard)

- [x] **Task 1.1**: `SparklineChart` + dotted `comparisonData`
  - Delivers: public plot-only sparkline; solid current series; dotted comparison aligned on `label`; no axes/grid/legend/tooltip row; empty input does not throw
  - Files: `ui/src/SparklineChart.tsx`, `ui/src/SparklineChart.test.tsx`, `ui/src/charts/paths.ts` (reuse line path), `ui/src/Common.ts` (TypeDoc props), `ui/src/index.tsx` / `heavyOptionalExports.tsx`
  - Blocked by: none
  - Skills: `terreno-ui`, `update-docs`
  - Docs: stub `SparklineChart` on `docs/reference/ui.md` Display list
  - Acceptance: bun tests — N points → path present; comparison path present when `comparisonData` set; empty data shows nothing / emptyText if provided; `ui` compile green

- [x] **Task 1.2**: `Scorecard` + `ChartCard`
  - Delivers: KPI tile with title, formatted value, optional sparkline; `ChartCard` with title, period badge, optional `onPeriodPress`, optional `filterSummary`
  - Files: `ui/src/Scorecard.tsx`, `ui/src/Scorecard.test.tsx`, `ui/src/ChartCard.tsx`, `ui/src/ChartCard.test.tsx`, lazy exports
  - Blocked by: 1.1
  - Skills: `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: stub both on `docs/reference/ui.md`
  - Acceptance: bun tests — value + title render; sparkline mounts when `sparklineData` set; badge press fires; period badge has no press handler when `onPeriodPress` omitted

- [x] **Task 1.3**: Scorecard demo + first golden
  - Delivers: demo story; gallery fixture `scorecard-sparkline-comparison` (five KPI tiles, static data); PNG golden
  - Files: `demo/stories/Scorecard.stories.tsx`, `demo/stories/ChartCard.stories.tsx`, `demo/demoConfig.tsx`, `demo/chartVisual/fixtureCatalog.ts`, `demo/chartVisual/fixtures.tsx`, `demo/rendered-snapshots/scorecard-sparkline-comparison.png`
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `review-chart-visuals`, `verify-ui-changes`
  - Docs: `docs/how-to/compare-chart-rendered-snapshots.md` lists the new id
  - Acceptance: fixture catalog test includes the id; `bun run ui:charts:compare` green for it; story registered

## Phase 2 — Cartesian additive facades

- [x] **Task 2.1**: `series` + `comparisonData` on `LineChart` / `AreaChart`
  - Delivers: multi-series lines from `series`; single `data` still works; dotted comparison overlay; per-series legend; markers stay
  - Files: `ui/src/LineChart.tsx`, `ui/src/AreaChart.tsx`, matching tests, `ui/src/charts/scales.ts` (shared x domain across series)
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `update-docs`
  - Docs: `docs/reference/ui.md` Line/Area props
  - Acceptance: bun tests — three `series` → three paths + three legend labels; `{label,value}[]` only still draws one series; comparison path exists when set

- [x] **Task 2.2**: `xTickPolicy` + bar comparison + header shortcuts
  - Delivers: `"auto"` rotates when labels would truncate, stays horizontal for ≤7 categories; `BarChart` accepts `series` (grouped later if >1 — this slice: first series only unless a second is comparison) and `comparisonData`; `title` / `periodLabel` / `onPeriodPress` on cartesian facades
  - Files: `ui/src/BarChart.tsx`, `ui/src/LineChart.tsx`, `ui/src/charts/layout.ts`, `ui/src/BarChart.test.tsx`, `ui/src/LineChart.test.tsx`
  - Blocked by: 2.1
  - Skills: `terreno-ui`
  - Docs: tick policy in `docs/explanation/charts.md`
  - Acceptance: bun tests — 14 long date labels with `auto` → rotated tick style; 7 weekday labels stay horizontal; facade title renders when set and `ChartCard` is not wrapping (documented exclusive use)

- [x] **Task 2.3**: Cartesian goldens
  - Delivers: fixtures `bar-time-rotated-ticks`, `line-three-series`, `bar-day-of-week`
  - Files: `demo/chartVisual/**`, `demo/rendered-snapshots/*.png`
  - Blocked by: 2.2
  - Skills: `review-chart-visuals`, `verify-ui-changes`
  - Docs: compare-how-to fixture table
  - Acceptance: `bun run ui:charts:compare` green for the three ids

## Phase 3 — Donut center and share legend

- [x] **Task 3.1**: Donut hole + percent legend
  - Delivers: `centerTitle`, `centerValue`; legend `swatch + label + formatShare` (default percent of total); 100% single-slice still draws a ring + center
  - Files: `ui/src/DonutChart.tsx`, `ui/src/DonutChart.test.tsx`
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `update-docs`
  - Docs: `docs/reference/ui.md` Donut props
  - Acceptance: bun tests — center copy present; legend includes `%`; one-slice data still has one path; existing slice color override still works

- [x] **Task 3.2**: Donut goldens
  - Delivers: `donut-center-and-share`, `donut-single-slice`
  - Files: `demo/chartVisual/**`, goldens
  - Blocked by: 3.1
  - Skills: `review-chart-visuals`
  - Docs: compare-how-to
  - Acceptance: compare green for both ids

## Phase 4 — Spanning grid

- [x] **Task 4.1**: `DashboardGridItem` spans
  - Delivers: eager `DashboardGridItem` with `span` per breakpoint; default span 1; children without a wrapper keep current equal-column behavior
  - Files: `ui/src/DashboardGrid.tsx` and/or `ui/src/DashboardGridItem.tsx`, `ui/src/DashboardGrid.test.tsx`, `ui/src/index.tsx` (eager)
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `update-docs`
  - Docs: `docs/reference/ui.md` Layout
  - Acceptance: bun tests — span 2 in a 4-column row yields ~2× cell width minus gap; unwrapped children still fill 1 column

- [ ] **Task 4.2**: `hows-it-going-dashboard` chart composition
  - Delivers: hard fixture matching the reference layout (5 scorecards, cost/conv bar, 3-line imp share, DOW bar, two donuts). Table slot may be a `ChartCard` placeholder until 5.2
  - Files: `demo/chartVisual/fixtures.tsx`, `fixtureCatalog.ts`, golden
  - Blocked by: 2.3, 3.2, 4.1
  - Skills: `review-chart-visuals`, `verify-ui-changes`
  - Docs: how-to example rewritten to this composition
  - Acceptance: compare green; fixture uses `Scorecard` / `ChartCard` / `DashboardGridItem`, not ad-hoc `Box` widths only

## Phase 5 — Table chrome

- [ ] **Task 5.1**: Header groups, footer rows, range status, wrapLines
  - Delivers: `headerGroups` second header row; `footerRows` sticky totals; range copy `start–end of total` with existing pagination; `wrapLines={2}` wraps cell text inside `rowHeight` (virtualization unchanged)
  - Files: `ui/src/DataTable.tsx`, `ui/src/DataTable.test.tsx`, `ui/src/Pagination.tsx` (if range lives there), `ui/src/Common.ts`
  - Blocked by: 4.1
  - Skills: `terreno-ui`, `update-docs`
  - Docs: `docs/reference/ui.md` DataTable; pointer from charts how-to
  - Acceptance: bun tests — grouped header text visible; footer row present; range text `1–50 of 452` with page 1 size 50 total 452; pinned column scroll still syncs with groups/footer; wrapLines 2 does not change `rowHeight`

- [ ] **Task 5.2**: Table card in the hard fixture
  - Delivers: one `ChartCard` + `DataTable` in `hows-it-going-dashboard` (Search Terms or Ad Group Check-in static rows, totals, period headers)
  - Files: `demo/chartVisual/fixtures.tsx`, update golden
  - Blocked by: 5.1, 4.2
  - Skills: `review-chart-visuals`, `verify-ui-changes`
  - Docs: how-to shows table in the same grid
  - Acceptance: compare green after intentional golden update; wrapped first-column names visible in the PNG

## Phase 6 — Packaging and docs

- [ ] **Task 6.1**: Lazy root + import regression
  - Delivers: `Scorecard`, `SparklineChart`, `ChartCard`, chart facades stay on `heavyOptionalExports`; `DashboardGrid` / `DashboardGridItem` eager; root import does not evaluate chart files
  - Files: `ui/src/lazyBoundaries/heavyOptionalExports.tsx`, `ui/src/index.tsx`, `ui/src/RootImportRegression.test.tsx`, `docs/reference/ui-performance.md`
  - Blocked by: 4.1, 5.1, 2.1, 3.1
  - Skills: `terreno-ui`, `update-docs`
  - Docs: performance page lists new lazy exports
  - Acceptance: `RootImportRegression` fails if new chart files load with the root import; subpath imports work

- [ ] **Task 6.2**: Diátaxis + changelog + rules
  - Delivers: how-to rewritten for easy-build composition; explanation covers scorecard, comparison stroke, additive facades vs grammar; reference complete; changelog fragment; ui rule export list; TypeDoc
  - Files: `docs/how-to/charts-and-dashboards.md`, `docs/explanation/charts.md`, `docs/reference/ui.md`, `docs/how-to/README.md`, `.rulesync/rules/ui/00-ui.mdc`, `changelog/unreleased/dashboard-chart-parity.md`; `bun run website:generate` if needed
  - Blocked by: 6.1, 5.2
  - Skills: `update-docs`, `docs-audit`, `terreno-ui`
  - Docs: the files listed above
  - Acceptance: a stranger can copy the how-to into a screen that resembles the reference; explanation states grammar is not required; changelog `category: Added`; existing single-series how-to steps still valid as a subset

## Verification mapping

| Criterion | Method |
|-----------|--------|
| Scorecard + sparkline + comparison | bun tests + `scorecard-sparkline-comparison` PNG |
| Multi-series line | bun tests + `line-three-series` PNG |
| Rotated vs horizontal ticks | bun tests + `bar-time-rotated-ticks` / `bar-day-of-week` |
| Donut center + share | bun tests + donut goldens |
| Grid spans + reference layout | `hows-it-going-dashboard` PNG + grid unit tests |
| Table chrome | bun tests + table region of hard golden |
| Facade compatibility | existing `*Chart.test.tsx` stay green |
| Lazy charts | `RootImportRegression` |
| Frontend proof | `verify-ui-changes` on demo gallery; artifacts on the implementation PR |
