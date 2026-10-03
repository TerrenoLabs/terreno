import type {InlineDataset} from "@terreno/blocks";

export interface ChartPoint {
  label: string;
  value: number;
}

const CHART_HEIGHT: Record<"lg" | "md" | "sm", number> = {
  lg: 300,
  md: 220,
  sm: 160,
};

export const chartHeight = (height: "lg" | "md" | "sm" | undefined): number =>
  CHART_HEIGHT[height ?? "md"];

/**
 * Turns an inline dataset into the single series the chart components draw.
 * The agent cannot set a per-point color; only label and value leave this function.
 */
export const datasetToPoints = ({
  dataset,
  x,
  y,
}: {
  dataset: InlineDataset;
  x: string;
  y: string;
}): ChartPoint[] => {
  const xIndex = dataset.columns.findIndex((column) => column.name === x);
  const yIndex = dataset.columns.findIndex((column) => column.name === y);
  if (xIndex < 0 || yIndex < 0) {
    return [];
  }
  return dataset.rows.flatMap((row) => {
    const label = row[xIndex];
    const value = row[yIndex];
    if (typeof label !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
      return [];
    }
    return [{label, value}];
  });
};

/** Drops any extra fields, including color, from chart points. */
export const chartPoints = (
  points: readonly {color?: string; label: string; value: number}[]
): ChartPoint[] => points.map((point) => ({label: point.label, value: point.value}));
