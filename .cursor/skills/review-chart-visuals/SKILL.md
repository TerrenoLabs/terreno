---
name: review-chart-visuals
description: Review Terreno chart rendered-snapshot diffs with visual intelligence. Trigger when `bun run ui:charts:compare` fails, when LineChart/BarChart/AreaChart/DonutChart or DashboardGrid paint or layout changes, or when the user asks what changed in chart screenshots.
---
# Review chart visuals

JSON snapshots of React trees cannot prove chart paint. Compare **actually rendered**
PNGs. Architecture: [chart visual regression](../../../docs/how-to/compare-chart-rendered-snapshots.md).

## When to run

- `ui:charts:compare` exits non-zero
- Chart SVG, axis overlay, legend, empty state, or `DashboardGrid` layout changed
- A reviewer asks whether a chart screenshot change is intentional

## Workflow

1. **Render and diff**

   ```bash
   bun run ui:charts:compare
   ```

   Reuse a running demo on port 8085. First run without goldens: `bun run ui:charts:update-snapshots`.

2. **Read the report**

   Open `demo/chart-visual-output/report.json`. Every `mismatch` or `error` id is in scope.
   Ignore `match` rows.

3. **Look at the three PNGs for each failing id** (use the image reader, not a prose guess):

   | File | Meaning |
   | --- | --- |
   | `demo/rendered-snapshots/<id>.png` | Last accepted render |
   | `demo/chart-visual-output/actual/<id>.png` | What this checkout draws |
   | `demo/chart-visual-output/diff/<id>.png` | pixelmatch highlight |

4. **Describe the delta in visual terms.** Name what moved, clipped, recolored, or reflowed.
   Cover ticks, legend, plot fill, donut slice order, card grid columns, and empty copy.
   Quote the fixture `id` and its difficulty from `demo/chartVisual/fixtureCatalog.ts`.

5. **Classify each fail**

   | Class | Action |
   | --- | --- |
   | Regression (clipping, overflow, wrong color, missing marks, layout jump) | Fix the chart code. Re-run compare until match. Do not update goldens. |
   | Intentional design change | Explain the visual change in the PR. Then `bun run ui:charts:update-snapshots`. |
   | Flake (font load, antialias speckle under the ratio cap) | Re-run once. If it still fails, treat as regression. |

6. **Stop condition**

   Compare is green, or every remaining mismatch has an intentional-update golden plus a
   written visual description in the PR Verification table.

## Do not

- Treat `toMatchSnapshot()` JSON as chart visual proof
- Update goldens to hide a clip or overflow
- Skip opening the PNGs and infer the diff from the code patch alone
