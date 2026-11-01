# Implementation Plan: Dashboard chart parity

**Status:** Approved — 2026-09-25  
**Branch:** `cursor/dashboard-chart-parity-8a50`  
**Owner:** —  
**Created:** 2026-09-24  
**Roadmap issue:** — (create via `roadmap-item` after this IP is Approved; follow-up to [#1175](https://github.com/TerrenoLabs/terreno/issues/1175))  
**Task list:** [dashboard-chart-parity.md](../tasks/dashboard-chart-parity.md)  
**Depends on:** [charts-and-dashboards.md](charts-and-dashboards.md) (shipped Phases 1–5)  
**RTK deprecation flag:** None  
**Program:** [B2B platform](b2b-platform-program.md) track E  

## Goal

Make `@terreno/ui` able to compose an ops dashboard like the “How’s it going?”
reference: KPI scorecards with comparison sparklines, titled chart cards with period
badges, multi-series lines, donut hole labels, spanning grids, and Looker-like table
chrome — without copying Looker paint, and without requiring the Chart children grammar.

App authors rebuild that page from first-class primitives (`Scorecard`, `SparklineChart`,
`ChartCard`, spanning `DashboardGrid`, additive chart facades, `DataTable` extras). Proof
is a demo gallery fixture of the reference layout plus rendered PNG goldens.

## Non-Goals

- Pixel-identical Looker colors, fonts, or screenshot matching of the PDF JPEG.
- Shipping a date-range picker. Period badges may call `onPeriodPress`.
- Variable `DataTable` row height (would break virtualization).
- Dual-period numbers inside one table cell (current + previous stacked in the same cell).
- Replacing `{label, value}[]` facades with composition-only `Chart*` children.
- Implementing the Phase 6 composition grammar in this slice (still future work on
  `charts-and-dashboards`).
- Example-frontend screen, comms dashboard wiring, zoom/pan, combo charts, maps, heatmaps.
- Cross-chart filtering / drill-down.

## Decisions

| Question | Decision |
|----------|----------|
| Scope | All chart surfaces, headers, period badges, KPI cards, spanning grid, and the table chrome named below. Not the whole PDF pixel-for-pixel. |
| Easy-build surface | `ChartCard` (title + period badge + child) + `Scorecard` + spanning `DashboardGrid`. |
| Scorecards | Dedicated `Scorecard` facade plus reusable `SparklineChart`. |
| Comparison | First-class `comparisonData` with dotted stroke on sparkline and optional cartesian overlay. |
| Facades vs grammar | Keep `LineChart` / `BarChart` / `AreaChart` / `DonutChart`. Add additive props. This dashboard must not require a composition tree. |
| Visual language | Capabilities are theme-configurable. Default paint stays Terreno tokens, not a Looker preset. |
| Responsive grid | Configurable `span` on items. Reference fixture: KPI row 5→2→1; lower chart row 3→1. |
| Tables | Same IP. After the chart tracer: period header groups, sticky totals row, `1–50 of N` range status. Reuse existing pin/sort/pagination. |
| Wrapped names | Wrap up to two lines inside the existing `rowHeight`. Keep virtualization. |
| Period badge | Label plus optional `onPress`. No picker in this slice. |

## Architecture

```
DashboardGrid
  DashboardGridItem span={{sm,md,lg}}
    ChartCard title periodLabel onPeriodPress?
      Scorecard | LineChart | BarChart | DonutChart | DataTable
    Scorecard
      SparklineChart (plot only; solid + dotted comparison)
```

Existing facades stay the simple path. `ChartCard` is chrome around any child (chart or
table). Facade `title` / `periodLabel` / `onPeriodPress` are shortcuts that render the
same header inside the chart; callers use **either** `ChartCard` **or** those props, not
both.

### Public props (additive)

```typescript
interface ChartSeries {
  color?: string;
  data: Array<{color?: string; label: string; value: number}>;
  id: string;
  label: string;
  stroke?: "solid" | "dotted";
}

interface CartesianChartProps {
  comparisonData?: Array<{label: string; value: number}>;
  data: Array<{color?: string; label: string; value: number}>;
  formatValue?: (value: number) => string;
  onPeriodPress?: () => void;
  periodLabel?: string;
  series?: ChartSeries[];
  title?: string;
  xTickPolicy?: "auto" | "truncate" | "rotate";
  // existing: height, legendLabel, emptyText, loading, accessibilityLabel, testID
}

interface DonutChartProps extends CartesianChartProps {
  centerTitle?: string;
  centerValue?: string;
  formatShare?: (value: number, total: number) => string;
}

interface SparklineChartProps {
  comparisonData?: Array<{label: string; value: number}>;
  data: Array<{label: string; value: number}>;
  height?: number;
  testID?: string;
}

interface ScorecardProps {
  comparisonData?: Array<{label: string; value: number}>;
  formatValue?: (value: number) => string;
  onPeriodPress?: () => void;
  periodLabel?: string;
  sparklineData?: Array<{label: string; value: number}>;
  title: string;
  value: number | string;
  testID?: string;
}

interface ChartCardProps {
  children: React.ReactNode;
  filterSummary?: string;
  onPeriodPress?: () => void;
  periodLabel?: string;
  title: string;
  testID?: string;
}

interface DashboardGridItemProps {
  children: React.ReactNode;
  span?: {lg?: number; md?: number; sm?: number};
  testID?: string;
}

interface DataTableProps {
  footerRows?: DataTableCellData[][];
  headerGroups?: Array<{columnCount: number; subtitle?: string; title: string}>;
  rangeStart?: number;
  rangeTotal?: number;
  wrapLines?: 1 | 2; // default 1; 2 = wrap inside rowHeight
  // existing page / setPage / totalPages remain; range copy uses page size math
}
```

`series` when present is the cartesian data source (`data` is ignored except as a
single-series fallback). `comparisonData` aligns on `label` and paints a dotted stroke
(sparkline/line) or a lighter overlay (bar — if labels match). Default `xTickPolicy` is
`"auto"`: rotate ~45° when labels would truncate; keep horizontal for ≤7 categorical
labels.

Donut legend rows become `swatch + label + formatShare` (default percent of total).
`centerTitle` / `centerValue` sit in the hole via overlay `Text`.

`DashboardGridItem` span is in column units of the current breakpoint count (span 5 in a
5-column KPI row is full width on `sm` when `columns.sm === 1`).

`SparklineChart` draws no axes, grid, legend, or reserved tooltip row. Hit targets stay
≥24px when press/hover is wired; default is non-interactive (KPI sparkline).

`headerGroups` paint a second header row above `columns` (period title + optional
subtitle such as `(Previous period)`). `footerRows` stick to the bottom of the scroll
body. Range status is `rangeStart–rangeEnd of rangeTotal` next to existing pagination.

### File layout

| Path | Role |
|------|------|
| `ui/src/SparklineChart.tsx` | Public sparkline |
| `ui/src/Scorecard.tsx` | Public KPI tile |
| `ui/src/ChartCard.tsx` | Public title + period badge chrome |
| `ui/src/DashboardGridItem.tsx` | Public span wrapper (or named export from `DashboardGrid.tsx` — no barrel) |
| `ui/src/LineChart.tsx` etc. | Additive `series`, `comparisonData`, ticks, header shortcuts |
| `ui/src/DonutChart.tsx` | Center stack + share legend |
| `ui/src/DataTable.tsx` | Header groups, footer rows, range status, wrapLines |
| `ui/src/Pagination.tsx` | Range copy when totals provided |
| `demo/chartVisual/fixtureCatalog.ts` | New hard fixtures including `hows-it-going-dashboard` |
| `docs/how-to/charts-and-dashboards.md` | Rewrite around Scorecard + ChartCard + spans |

`DashboardGrid` stays eager. New chart widgets join `heavyOptionalExports`. `ChartCard`
and `Scorecard` are layout+text heavy enough to sit with charts (lazy). `DashboardGridItem`
stays eager with the grid.

### Chart visual regression

Add fixtures that exercise the reference patterns (not the JPEG pixels):

| id | Pattern |
|----|---------|
| `scorecard-sparkline-comparison` | Five KPI tiles, solid + dotted sparkline |
| `bar-time-rotated-ticks` | Vertical bars, rotated dates, y `formatValue` |
| `line-three-series` | Three lines, markers, per-series legend |
| `bar-day-of-week` | Seven categorical bars, horizontal ticks |
| `donut-center-and-share` | Hole label + percent legend |
| `donut-single-slice` | One 100% slice + center total |
| `hows-it-going-dashboard` | Spanning grid: 5 KPIs, time bar, 3-line, DOW bar, two donuts, one table card |

`bun run ui:charts:compare` must cover these. Agents use `review-chart-visuals`.

## Models / APIs / Notifications

None.

## UI

Universal React Native + web. Demo stories + visual gallery only. Tables stay `DataTable`
inside `ChartCard`.

## Phases

1. **Tracer:** `SparklineChart` + `Scorecard` + `ChartCard` + `comparisonData` on the
   sparkline; demo story; docs stub; golden for `scorecard-sparkline-comparison`.
2. **Cartesian additive:** `series`, `comparisonData`, `xTickPolicy`, header shortcuts on
   line/bar/area; goldens for time bar and 3-line.
3. **Donut:** center stack + share legend; goldens for two-slice and 100% slice.
4. **Grid spans:** `DashboardGridItem`; reference KPI wrap; compose `hows-it-going-dashboard`
   charts (table slot placeholder ok until Phase 5).
5. **Table chrome:** header groups, footer rows, range status, `wrapLines={2}`; table card
   in the hard fixture.
6. **Packaging + docs:** lazy exports, import regression, how-to rewrite, explanation,
   reference, TypeDoc, changelog, ui rule export list.

## Feature Flags & Migrations

None. Additive public props. Existing `{label, value}[]` callers stay valid. Not a major.

`legendLabel` remains for single-series cartesian. Multi-series uses `series[].label`.
Donut still ignores `legendLabel`.

## Activity Log & User Updates

None.

## Not Included / Future Work

- Chart children grammar (`Chart`, `ChartXAxis`, …) — still `charts-and-dashboards` Phase 6.
- Date-range picker control.
- Dual-period table cells.
- Variable row height.
- Example-frontend / comms wiring.
- Zoom/pan, combo charts.

## Files to Create / Modify

See the task list. Docs in-slice:

- `docs/how-to/charts-and-dashboards.md` (rewrite)
- `docs/explanation/charts.md` (multi-series, scorecard, why not grammar-first)
- `docs/reference/ui.md` (new exports)
- `docs/how-to/compare-chart-rendered-snapshots.md` (new fixture ids)
- `.rulesync/rules/ui/00-ui.mdc`
- `changelog/unreleased/dashboard-chart-parity.md`
- TypeDoc props (`bun run website:generate` in the docs task)

## Task List

[docs/tasks/dashboard-chart-parity.md](../tasks/dashboard-chart-parity.md)

## Acceptance Criteria

- [ ] `Scorecard`, `SparklineChart`, and `ChartCard` are importable from `@terreno/ui` and subpaths.
- [ ] A scorecard shows title, formatted value, and a sparkline with dotted `comparisonData`.
- [ ] `LineChart` renders three series from `series` with a legend item each.
- [ ] Time-series x ticks can rotate; day-of-week ticks stay horizontal under `auto`.
- [ ] `DonutChart` draws `centerTitle` / `centerValue` and percent legend rows.
- [ ] `DashboardGridItem` spans reproduce 5→2→1 KPI and 3→1 chart wrapping in the reference fixture.
- [ ] `DataTable` shows period header groups, a sticky totals row, `1–50 of N`, and two-line wrap inside `rowHeight`.
- [ ] Existing single-series `{label, value}[]` charts and tests stay green.
- [ ] `bun run ui:charts:compare` matches goldens including `hows-it-going-dashboard`.
- [ ] How-to shows the easy-build composition (Scorecard + ChartCard + spans), not only raw `Card` + `LineChart`.
- [ ] Chart implementations stay lazy on the root; grid item stays eager.
- [ ] Frontend verification: demo gallery exercised on web; artifacts on the implementation PR.

## Risks

| Risk | Mitigation |
|------|------------|
| Dual header APIs (`ChartCard` vs facade title) | Document exclusive use; tests assert no double header when only one is set |
| `DataTable` wrap vs virtualization | Cap at two lines; keep `rowHeight`; screenshot a wrapped first column |
| Additive `series` vs later grammar | Facades remain the supported easy path; grammar stays a follow-up |
| Golden flake on dense dashboards | One hard fixture at a fixed gallery width; review-chart-visuals on mismatch |
| Header groups vs pinned columns | Totals and groups must align with `pinnedColumns` scroll sync; regression tests |
