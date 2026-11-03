# Implementation Plan: Charts and dashboard primitives

**Status:** In progress  
**Branch:** `cursor/charts-and-dashboards-2bc3`  
**Owner:** —  
**Created:** 2026-09-10  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1175 (this feature **closes** that issue; implementation PRs use `Fixes #1175`)  
**Task list:** [charts-and-dashboards.md](../tasks/charts-and-dashboards.md)  
**Depends on:** —  
**RTK deprecation flag:** None  
**Program:** [B2B platform](b2b-platform-program.md) track E  

## Goal

Ship themed, universal chart and dashboard layout primitives in `@terreno/ui` so B2B
admin and product screens can compose line, bar, area, and donut charts without a
third-party chart API leaking into app code.

Rendering is **owned SVG** on `react-native-svg` (already used for icons). Public
components are `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, and `DashboardGrid`.
Proof is demo stories plus docs. No example-frontend screen and no comms-dashboard
wiring in this slice.

## Non-Goals

- `victory-native`, Skia canvas charts, `react-native-gifted-charts`, `react-native-chart-kit`, WebView/ECharts.
- Example-frontend dashboard screen.
- Comms admin stats charts (comms IP already defers to this item; a later comms task consumes these primitives).
- Zoom, pan, brush, stacked/grouped multi-series cartesian, combo charts, maps, heatmaps.
- A new `DashboardCard` (reuse `Card`).
- Dark-mode palette work (`dark-mode-theme`); charts read `useTheme()` so they follow when that ships.
- Implementing the approved composition grammar in the visual-regression slice (Phase 6).

## Decisions

| Question | Decision |
|----------|----------|
| Public exports | Named `LineChart`, `BarChart`, `AreaChart`, `DonutChart`. No `Chart` dispatcher. Remove the commented `export * from "./Chart"` stub. |
| First consumer | Demo stories only. |
| Interactivity | Legend plus press (native) / hover (web) tooltip. No zoom/pan. |
| Dashboard layout | `DashboardGrid` with responsive column counts; children are existing `Card`s. |
| Engine | Owned `react-native-svg` primitives in `@terreno/ui`. Not victory-native, not a wrap. |
| Series model | Single series this slice: `data: {label: string; value: number}[]`. Donut uses the same points as slices (`color?` optional per slice). Multi-series cartesian is future work. |
| Math | Private `d3-scale` + `d3-shape` in `ui/` only (single-package; raw versions, not catalog unless a second package needs them). Do not export d3 types. |
| Axis labels | Overlay `@terreno/ui` `Text` (theme fonts). Do not draw axis copy with SVG `<Text>` as the primary path. |
| Tooltip chrome | Terreno `Tooltip` when a mark can be the child; otherwise an internal overlay `Box`+`Text` at the hit point with the same copy (`label: value`). |
| Empty / loading | Empty `data` → `Text` (`emptyText`, default `"No data"`). `loading` → `Spinner`. |
| Colors | Theme tokens: series/slice fills from `primary` / `secondary` / `accent` / `error` (and tints). Grid/axis from `border` / `text.secondaryDark`. Optional `color` on a donut slice overrides. |
| Packaging | Chart components join the existing lazy root boundary (`heavyOptionalExports`). `DashboardGrid` stays eager (layout only). Subpaths `@terreno/ui/LineChart` etc. remain direct. |
| Dates | `label` is a display string. Callers format with Luxon before passing. No `Date` objects in props. |
| Visual proof | Rendered PNG goldens via `bun run ui:charts:compare`, not React JSON snapshots. |

## Architecture

```
@terreno/ui
  LineChart / BarChart / AreaChart / DonutChart
    ChartFrame (Box + sized Svg + overlay Text axes + legend + tooltip)
      charts/scales.ts   d3-scale linear / band (private)
      charts/paths.ts    d3-shape line / area / arc (private)
      charts/theme.ts    useTheme → stroke / fill / grid / axis
  DashboardGrid
    Box wrap + width percent from breakpoint column count
```

### Public props (minimal)

```typescript
interface ChartPoint {
  label: string;
  value: number;
  color?: string; // donut slice override
}

interface CartesianChartProps {
  data: ChartPoint[];
  height?: number; // default 200
  legendLabel?: string;
  emptyText?: string;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

interface DashboardGridProps {
  columns?: {sm?: number; md?: number; lg?: number}; // default 1 / 2 / 3
  gap?: SignedUpTo12;
  children: React.ReactNode;
  testID?: string;
}
```

Cartesian charts share `CartesianChartProps`. `DonutChart` uses the same `data` as slices
(ignore `legendLabel`; legend is one row per slice).

Layout: `Box` around an `Svg` with a stable `viewBox`. Plot geometry is SVG. Tick labels
sit in `Box` rows/columns around the plot so Nunito/Titillium apply. Legend is a wrapping
`Box` of color swatch + `Text` below the plot.

Hit testing: map press/hover location to the nearest point (cartesian) or slice (donut).
Web uses hover in; native uses press. Tooltip copy is `{label}: {value}` (no extra
formatting unless `value` is shown with a caller-supplied `formatValue?: (n) => string`,
default `String(n)`).

### File layout

| Path | Role |
|------|------|
| `ui/src/charts/types.ts` | `ChartPoint` and shared props (not a public barrel) |
| `ui/src/charts/scales.ts` | Private scale helpers + unit tests |
| `ui/src/charts/paths.ts` | Private path helpers + unit tests |
| `ui/src/charts/theme.ts` | Theme → paint |
| `ui/src/charts/ChartFrame.tsx` | Shared frame (not exported from package root) |
| `ui/src/LineChart.tsx` | Public line |
| `ui/src/BarChart.tsx` | Public bar |
| `ui/src/AreaChart.tsx` | Public area |
| `ui/src/DonutChart.tsx` | Public donut |
| `ui/src/DashboardGrid.tsx` | Public grid |
| `ui/src/index.tsx` | Eager `DashboardGrid`; lazy chart named exports |
| `ui/src/lazyBoundaries/heavyOptionalExports.tsx` | Chart lazy factories |
| `ui/package.json` | `d3-scale`, `d3-shape` (+ types) |

No `ui/src/charts/index.ts` barrel (Biome `noBarrelFile`).

### Dependencies

`react-native-svg` is already a `ui` dependency. Add `d3-scale` and `d3-shape` to `ui/`
only. Do not add `victory-native`. Import-benchmark and `RootImportRegression` must show
chart implementation modules off the cold `@terreno/ui` root graph (same pattern as
`GPTChat`).

### Chart visual regression

JSON snapshots of the React tree do not prove paint. The demo hosts
`/demo/chart-visual-gallery` (easy → hard fixtures in
`demo/chartVisual/fixtureCatalog.ts`). `bun run ui:charts:compare` launches Chromium,
screenshots each `[data-testid=chart-visual-<id>]`, and pixel-diffs against
`demo/rendered-snapshots/<id>.png`. Failures write
`demo/chart-visual-output/{actual,diff,report.json}`. Agents follow
`review-chart-visuals`. `bun run ui:charts:update-snapshots` rewrites goldens after an
intentional visual change.

### Testing

Bun + `@testing-library/react-native` + `renderWithTheme`. Assert:

- Empty and loading states by text / `testID`.
- One mark per `data` item (`testID` suffix by index or label).
- Tooltip copy after press (native) or hover where the test renderer allows.
- Legend label / slice labels.
- Scale/path helpers with numeric fixtures (no renderer).
- `DashboardGrid`: child count and `testID`; width math via style when observable.

Do not mock `react-native-svg` unless a helper is untestable; prefer querying `testID`s
on wrapper `Box`es if SVG nodes are opaque in happy-dom.

### Demo

Stories: `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, `DashboardGrid` (grid of
`Card`s each holding a chart). Register in `demoConfig.tsx` so the demo coverage
allowlist passes. Static fixture data only.

## Models / APIs / Notifications

None.

## UI

Universal React Native + web. No admin-v2 `home.slots` work. Comms dashboard is a future
consumer, not this IP.

## Phases

1. **Tracer:** private scales/paths/theme + `LineChart` (tooltip, legend, empty/loading) +
   tests + demo story + reference stub.
2. **Sibling charts:** `BarChart`, `AreaChart`, `DonutChart` on the same frame.
3. **DashboardGrid** + composing demo story.
4. **Packaging + docs:** lazy root exports, import regression, Diátaxis pages, TypeDoc,
   changelog fragment, seed links, rules/skill mentions.
5. **Rendered visual regression:** gallery + compare command + `review-chart-visuals` skill.
6. **Composition grammar (approved, not this slice):** declarative children (`Chart`,
   `ChartTitle`, cartesian/polar, series, axes, grid, legend, tooltip, data labels,
   reference line/band). Keyed rows + `dataKey`. Facades stay additive `{label,value}`.
   Tooltip overlay + footer (facades keep footer). Colors: theme tokens + hex.
   `data`/`xKey` on `Chart`/`ChartCartesian`/`ChartPolar`. Grouped bars unless `stackId`.

## Feature Flags & Migrations

None. Additive public components. Not a major.

## Activity Log & User Updates

None.

## Not Included / Future Work

- Ops-dashboard parity (scorecards, comparison sparklines, additive multi-series, donut centers, spanning grid, table chrome) — [`dashboard-chart-parity.md`](dashboard-chart-parity.md).
- Composition grammar (Phase 6) — recorded Grow decisions; implement on a follow-up Pick. Not required for the How’s it going dashboard.
- Multi-series cartesian via additive `series` lands in `dashboard-chart-parity`; grammar `dataKey` / `stackId` remains later.
- Wiring `CommsDashboardScreen` charts to the stats endpoint.
- Example-frontend dashboard.
- Zoom/pan.
- Victory/Skia renderer if a later product needs GPU-scale series (thousands of points).

## Files to Create / Modify

See the task list. Docs created or updated in-slice:

- `docs/how-to/charts-and-dashboards.md` (create)
- `docs/how-to/README.md` (link)
- `docs/explanation/charts.md` (create — why owned SVG, not victory-native)
- `docs/explanation/README.md` (link)
- `docs/reference/ui.md` (Display exports + example)
- `docs/explanation/roadmap-seed-issues.md` (`charts-and-dashboards` IP/task links)
- `docs/implementationPlans/b2b-platform-program.md` / `comms-admin-dashboard.md` (pointer only if they still say “charts later” without a path)
- `.rulesync/rules/ui/00-ui.mdc` (export list)
- `changelog/unreleased/charts-and-dashboards.md`
- TypeDoc props so `docs-audit` is clean after `bun run website:generate`

## Task List

[docs/tasks/charts-and-dashboards.md](../tasks/charts-and-dashboards.md)

## Acceptance Criteria

- [ ] `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, and `DashboardGrid` are
      importable from `@terreno/ui` and from component subpaths.
- [ ] Charts render with `react-native-svg`; `victory-native` is not a dependency.
- [ ] Single-series `{label, value}[]` is the only cartesian data contract.
- [ ] Empty and loading states are visible; tooltip + legend work (press native, hover web).
- [ ] Theme tokens drive default paints; overlay axis labels use `Text`.
- [ ] Chart implementations are lazy on the package root; `DashboardGrid` is eager.
- [ ] Focused bun tests cover scales, empty/loading, mark counts, tooltip copy, grid columns.
- [ ] Demo stories exist for all five exports and are registered.
- [ ] How-to, explanation, and `docs/reference/ui.md` describe the API; TypeDoc props exist.
- [ ] `bun test` (ui affected files), `bun run compile` in `ui`, and demo compile succeed.
- [ ] Frontend verification: demo stories exercised on web; artifacts on the implementation PR.
- [x] `bun run ui:charts:compare` matches `demo/rendered-snapshots/` for the gallery.

## Risks

| Risk | Mitigation |
|------|------------|
| happy-dom SVG nodes hard to query | `testID` on `Box` wrappers around marks; helper unit tests for path strings |
| Hover vs press tooltip | Shared hit-test helper; platform-specific event wiring; tests cover press at minimum |
| Root import size | Lazy boundary + `performance:imports` / `RootImportRegression` |
| d3 + RN types | Confine d3 to `charts/scales.ts` and `charts/paths.ts` |
