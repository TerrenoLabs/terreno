# Compose charts in a dashboard grid

Put each chart in a `Card`, then wrap the cards in `DashboardGrid`.

```tsx
import type {FC} from "react";
import {BarChart, Card, DashboardGrid, LineChart} from "@terreno/ui";

const POINTS = [
  {label: "Mon", value: 3},
  {label: "Tue", value: 5},
];

export const OpsDashboard: FC = () => {
  return (
    <DashboardGrid>
      <Card>
        <LineChart data={POINTS} legendLabel="Signups" />
      </Card>
      <Card>
        <BarChart data={POINTS} legendLabel="Sessions" />
      </Card>
    </DashboardGrid>
  );
};
```

1. Pass a single series of `{label, value}` points.
2. Use `emptyText` and `loading` on the chart, not a custom overlay.
3. Press or hover a mark for `{label}: {value}`. Zero and negative bars stay pressable; bars grow from the zero baseline.
4. Keep `DashboardGrid` eager; import charts from `@terreno/ui/LineChart` when cold start matters. `gap` is subtracted from cell width so the breakpoint column count still fits.

`DonutChart` ignores `legendLabel` and draws one legend row per slice. Override a slice with `color` on that point.

Charts have no width prop: each one fills the container you put it in and redraws when that width changes, so size the `Card` or `Box` around it. `height` is the chart's whole height, tick row and tooltip row included, so `height={140}` fits a 140px slot; the tooltip row is always reserved so hovering never reflows the page. Long x labels truncate inside their band rather than widening the chart.

Prove paint with `bun run ui:charts:compare` against `demo/rendered-snapshots/`, not with JSON snapshots. See [Compare rendered chart snapshots](compare-chart-rendered-snapshots.md).

The example app admin home (`example-frontend/components/AdminCharts.tsx`, mounted
below the admin dashboard at `/admin`) shows the same pieces together: scorecards with comparison
sparklines, a multi-series line, a donut with a center label, a bar chart, and an
area chart inside a spanning `DashboardGrid`.
