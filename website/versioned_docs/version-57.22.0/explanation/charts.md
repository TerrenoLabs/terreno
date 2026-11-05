# Why Terreno owns chart SVG

Terreno charts are drawn with `react-native-svg` and private `d3-scale` / `d3-shape` helpers inside `@terreno/ui`. Apps import `LineChart`, `BarChart`, `AreaChart`, and `DonutChart` — not d3 types and not a third-party chart API.

`victory-native` was rejected for this slice: Skia canvas fights Terreno theme fonts, bun tests, and accessibility. Owned SVG lets axis labels stay `@terreno/ui` `Text` (Nunito/Titillium) and lets hit targets stay clickable `Box`es with `testID`s.

`BarChart` grows each bar from the zero baseline (up for positives, down for negatives). A zero value draws no sliver; the press/hover hit stays at least 24px so the tooltip still works.

`DonutChart` uses `d3-shape` `arc` angles (`0` is 12 o'clock, clockwise). Slice press/hover hits use the same paint transform so the tooltip lands on the visible slice.

Axis ticks and donut legend labels use `Text` with `skipLinking`, matching `ChartFrame` tooltips, so a URL in `point.label` stays inert text instead of `Linking.openURL`.

Sizing flows one way: the frame stretches to the container (`alignSelf: stretch`), the plot
measures itself with `onLayout`, and the drawing is clipped to that measurement. Nothing inside a
chart may set its own min-content width, or the container would size to the chart and the chart
would size to the container. That is why x tick labels are absolutely positioned on their band
centers instead of laid out in a row, and why the plot column sets `minWidth: 0`.

Height works the same way: `height` is the whole chart, and the tick row, tooltip row, and legend
row come out of that budget. A chart therefore fits a fixed-height slot, and reserving the tooltip
row even when no tooltip is showing keeps hovering from reflowing the page.

Cartesian facades use `xTickPolicy="auto"` by default: up to seven categorical labels
stay horizontal, while denser sets rotate 45 degrees and reserve a taller axis row.
That taller row comes out of `height`; the plot shrinks so the chart still fits the
requested slot. `SparklineChart` scales to the data range so a small period-over-period
change stays visible.
Callers may force `"truncate"` or `"rotate"`. `title` and `periodLabel` are convenience
props backed by the same `ChartCard` used for explicit chart/table composition.

`DashboardGrid` is layout only, so it stays on the eager root export. Chart implementations sit behind the same lazy root boundary as `GPTChat`. Cell width subtracts flex `gap` so `md`/`lg` column counts actually fit.

Chart paint is proven with **rendered PNG goldens**, not React test-renderer JSON.
`bun run ui:charts:compare` opens the demo gallery
(`/demo/chart-visual-gallery`), screenshots each fixture from easy to hard, and
pixel-diffs against `demo/rendered-snapshots/`. Agents use the `review-chart-visuals`
skill to read golden / actual / diff images when a compare fails.

The example app admin home (`/admin`) mounts `AdminCharts` so scorecards, a multi-series line,
bars, an area, and a donut with a center label render together. See
[Compose charts in a dashboard grid](../how-to/charts-and-dashboards.md).
