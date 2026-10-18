# Tasks: Charts and dashboard primitives

IP: [charts-and-dashboards.md](../implementationPlans/charts-and-dashboards.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1175

**Feature profile:** false (full IP)

## Phase 1 — Tracer (`LineChart`)

- [x] **Task 1.1**: Private scale/path/theme helpers
  - Delivers: linear and band scales plus line/area/arc path strings from `{label, value}[]`; theme paint map from `useTheme`; no public d3 types
  - Files: `ui/src/charts/types.ts`, `ui/src/charts/scales.ts`, `ui/src/charts/paths.ts`, `ui/src/charts/theme.ts`, `ui/src/charts/scales.test.ts`, `ui/src/charts/paths.test.ts`, `ui/package.json` (`d3-scale`, `d3-shape`, types)
  - Blocked by: none
  - Skills: `terreno-ui`, `update-docs`
  - Docs: none yet (helpers are private); record the dependency choice in the IP (already decided)
  - Acceptance: bun tests — known fixtures produce expected domain/range and path `d` containing the fixture points; empty input does not throw

- [x] **Task 1.2**: `LineChart` + frame (tooltip, legend, empty, loading)
  - Delivers: public `LineChart` on owned SVG; overlay `Text` ticks; legend when `legendLabel` set; tooltip `{label}: {value}` on press (and hover on web); empty `Text`; `loading` `Spinner`; per-point `testID` / a11y labels
  - Files: `ui/src/charts/ChartFrame.tsx`, `ui/src/LineChart.tsx`, `ui/src/LineChart.test.tsx`, `ui/src/index.tsx` (lazy export; may be a temporary direct export until 4.1), `ui/src/Common.ts` (TypeDoc props if that is the audit source)
  - Blocked by: 1.1
  - Skills: `terreno-ui`, `verify-ui-changes`
  - Docs: stub `LineChart` in `docs/reference/ui.md` Display list so the tracer is documented when it lands
  - Acceptance: bun tests — 3 points → 3 mark testIDs; empty data shows `emptyText`; `loading` shows spinner; press on a mark shows tooltip copy; `legendLabel` renders. `ui` compile green.

- [x] **Task 1.3**: `LineChart` demo story
  - Delivers: demo story with default, empty, loading, and tooltip-able data; registered in `demoConfig.tsx`
  - Files: `demo/stories/LineChart.stories.tsx`, `demo/demoConfig.tsx` (and story-config if that package requires a config module)
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `verify-ui-changes`
  - Docs: none beyond the story
  - Acceptance: `bun run demo:compile` (or package equivalent) passes; story is reachable in `demoConfig`

## Phase 2 — Sibling charts

- [x] **Task 2.1**: `BarChart`
  - Delivers: public `BarChart` on `ChartFrame`; one bar per point; same empty/loading/tooltip/legend/a11y contract as `LineChart`
  - Files: `ui/src/BarChart.tsx`, `ui/src/BarChart.test.tsx`, `ui/src/index.tsx`, `demo/stories/BarChart.stories.tsx`, `demo/demoConfig.tsx`
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: add `BarChart` to `docs/reference/ui.md`
  - Acceptance: bun tests for mark count, empty, tooltip copy; demo story registered; compile green

- [x] **Task 2.2**: `AreaChart`
  - Delivers: public `AreaChart` (filled path + line) on `ChartFrame`; same contract
  - Files: `ui/src/AreaChart.tsx`, `ui/src/AreaChart.test.tsx`, `ui/src/index.tsx`, `demo/stories/AreaChart.stories.tsx`, `demo/demoConfig.tsx`
  - Blocked by: 1.2
  - Skills: `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: add `AreaChart` to `docs/reference/ui.md`
  - Acceptance: bun tests for area path presence / mark count, empty, tooltip; demo story registered

- [x] **Task 2.3**: `DonutChart`
  - Delivers: public `DonutChart`; one slice per point; per-slice `color` override; legend is one row per slice (ignore `legendLabel`); tooltip on slice press/hover
  - Files: `ui/src/DonutChart.tsx`, `ui/src/DonutChart.test.tsx`, `ui/src/index.tsx`, `demo/stories/DonutChart.stories.tsx`, `demo/demoConfig.tsx`
  - Blocked by: 1.1
  - Skills: `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: add `DonutChart` to `docs/reference/ui.md`
  - Acceptance: bun tests — N slices, color override on one slice, empty, tooltip copy; demo story registered

## Phase 3 — Dashboard grid

- [x] **Task 3.1**: `DashboardGrid`
  - Delivers: eager public `DashboardGrid`; default columns `{sm: 1, md: 2, lg: 3}`; wraps children with gap; children remain `Card`s supplied by the caller
  - Files: `ui/src/DashboardGrid.tsx`, `ui/src/DashboardGrid.test.tsx`, `ui/src/index.tsx` (eager export), `demo/stories/DashboardGrid.stories.tsx`, `demo/demoConfig.tsx`
  - Blocked by: 1.2 (demo composition uses `LineChart`; grid component itself does not)
  - Skills: `terreno-ui`, `verify-ui-changes`, `update-docs`
  - Docs: add `DashboardGrid` to `docs/reference/ui.md` Layout list
  - Acceptance: bun tests — default column map, custom `columns`, `gap`, child `testID`s still present; demo story shows a grid of `Card`+chart; compile green

## Phase 4 — Packaging and docs

- [x] **Task 4.1**: Lazy root boundary + import regression
  - Delivers: `LineChart`, `BarChart`, `AreaChart`, `DonutChart` on `heavyOptionalExports`; `DashboardGrid` stays eager; root import does not evaluate chart implementation modules; subpath imports still work
  - Files: `ui/src/lazyBoundaries/heavyOptionalExports.tsx`, `ui/src/index.tsx`, `ui/src/RootImportRegression.test.tsx`, `docs/reference/ui-performance.md` (list charts with other heavy widgets)
  - Blocked by: 2.1, 2.2, 2.3, 3.1
  - Skills: `terreno-ui`, `update-docs`
  - Docs: `docs/reference/ui.md` performance section names the chart lazy exports
  - Acceptance: `RootImportRegression` (or equivalent) fails if chart files load with the root import; `bun run performance:imports` does not regress beyond documented noise; subpath `import {LineChart} from "@terreno/ui/LineChart"` works

- [x] **Task 4.2**: Diátaxis + changelog + rules + seed
  - Delivers: how-to (compose charts in a `DashboardGrid` of `Card`s), explanation (why owned SVG vs victory-native), reference complete, how-to/explanation README links, TypeDoc props, changelog fragment, ui rule export list, roadmap seed IP/task GitHub links, comms/b2b pointers if they still say “not yet written”
  - Files: `docs/how-to/charts-and-dashboards.md`, `docs/how-to/README.md`, `docs/explanation/charts.md`, `docs/explanation/README.md`, `docs/reference/ui.md`, `docs/explanation/roadmap-seed-issues.md`, `docs/implementationPlans/comms-admin-dashboard.md` (link only), `.rulesync/rules/ui/00-ui.mdc`, `changelog/unreleased/charts-and-dashboards.md`; `bun run rules` / `skills:sync` if rulesync requires it; `bun run website:generate` if TypeDoc pages are generated
  - Blocked by: 3.1, 4.1
  - Skills: `update-docs`, `docs-audit`, `terreno-ui`
  - Docs: the files listed above
  - Acceptance: a stranger can copy the how-to example into a screen; explanation states the victory-native rejection; seed `Implementation plan` / `Tasks` are not `*(not yet written)*`; `bun run website:build` if the docs site is in the slice; changelog fragment `category: Added`

## Phase 5 — Rendered visual regression

- [x] **Task 5.1**: Chart visual gallery + compare command + review skill
  - Delivers: easy-through-hard fixtures actually rendered in the demo; PNG goldens under `demo/rendered-snapshots/`; `bun run ui:charts:compare` / `ui:charts:update-snapshots`; `review-chart-visuals` skill
  - Files: `demo/chartVisual/**`, `demo/app/demo/chart-visual-gallery.tsx`, `scripts/charts/compareChartImages.ts`, `scripts/charts/compareRenderedSnapshots.ts`, `demo/rendered-snapshots/*.png`, `.rulesync/skills/review-chart-visuals/SKILL.md`, `docs/how-to/compare-chart-rendered-snapshots.md`, `docs/explanation/charts.md`, `docs/reference/ui.md`
  - Blocked by: 4.2
  - Skills: `verify-ui-changes`, `review-chart-visuals`, `update-docs`, `update-agent-docs`
  - Docs: how-to compare page; explanation + reference pointers; skill + `verify-ui-changes` hook
  - Acceptance: catalog tests; fixture render tests; pixelmatch unit tests; compare against goldens is green; skill is in `skills.sh.json` groupings

## Phase 6 — Composition grammar (not this slice)

- [ ] **Task 6.1**: Declarative `Chart` children grammar (follow-up Pick)
  - Delivers: `Chart`, `ChartTitle`, `ChartSubtitle`, `ChartCartesian`, `ChartPolar`, `ChartXAxis`, `ChartYAxis`, `ChartGrid`, `ChartLegend`, `ChartTooltip`, `ChartLine`, `ChartArea`, `ChartBar`, `ChartDonut`, `ChartDataLabels`, `ChartReferenceLine`, `ChartReferenceBand`; keyed rows + `dataKey`; facades additive `{label,value}`; tooltip overlay+footer; tokens+hex; grouped bars unless `stackId`
  - Files: `ui/src/Chart*.tsx` (flat named exports, no barrel)
  - Blocked by: 5.1
  - Skills: `terreno-ui`, `review-chart-visuals`, `update-docs`
  - Docs: how-to + reference rewritten for composition; visual goldens updated
  - Acceptance: a complex titled/labeled/colored chart is composed only from Terreno chart children; `ui:charts:compare` stays green

## Verification mapping

| Criterion | Method |
|-----------|--------|
| Four chart types + grid export | compile + import tests |
| No victory-native | `ui/package.json` / grep |
| Single-series contract | bun tests + TypeDoc props |
| Tooltip + legend + empty/loading | bun tests + demo web exercise |
| Theme + overlay `Text` | unit theme map + render tests |
| Lazy charts | `RootImportRegression` / import benchmark |
| Demo + docs | registered stories; how-to/explanation/reference exist |
| Frontend proof | `verify-ui-changes` on demo stories; artifacts on the implementation PR |
| Rendered paint | `bun run ui:charts:compare` vs `demo/rendered-snapshots/` |
