# Compare rendered chart snapshots

JSON snapshots of the React tree do not prove chart paint. Terreno renders a gallery of
easy-through-hard charts in the demo app and diffs those PNGs against goldens.

1. Start from the repo root (reuses demo web on port 8085 if it is already up):

   ```bash
   bun run ui:charts:compare
   ```

2. Open `http://localhost:8085/demo/chart-visual-gallery` if you want to see the same
   fixtures a person sees.

3. On a mismatch, inspect:

   - `demo/rendered-snapshots/<id>.png` — accepted render
   - `demo/chart-visual-output/actual/<id>.png` — this checkout
   - `demo/chart-visual-output/diff/<id>.png` — pixel highlight

4. If the new paint is the intended design, write goldens:

   ```bash
   bun run ui:charts:update-snapshots
   ```

5. Limit one fixture while iterating:

   ```bash
   bun scripts/charts/compareRenderedSnapshots.ts --only=line-three-points
   ```

Agents reviewing a fail should follow the `review-chart-visuals` skill and look at the
PNGs, not only the code diff.

Hard fixture `scorecard-sparkline-comparison` renders five KPI tiles with solid current
and dotted previous-period sparklines.
Cartesian parity fixtures are `bar-time-rotated-ticks`, `bar-day-of-week`, and
`line-three-series`.
Donut parity fixtures are `donut-center-and-share` and `donut-single-slice`.
Hard fixture `hows-it-going-dashboard` composes KPI scorecards, time-series charts, donuts,
and table placeholders in a spanning `DashboardGrid`.

`CHART_VISUAL_BASE_URL` overrides the demo origin when the gallery is already hosted.
