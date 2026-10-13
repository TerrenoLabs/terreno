import type {ChartPoint, ChartSeries} from "./types/chartTypes";

export const resolveChartSeries = ({
  data,
  legendLabel,
  series,
}: {
  data: ChartPoint[];
  legendLabel?: string;
  series?: ChartSeries[];
}): ChartSeries[] => {
  if (series && series.length > 0) {
    return series;
  }

  return [{data, id: "default", label: legendLabel ?? ""}];
};

export const getAllSeriesPoints = ({
  comparisonData = [],
  series,
}: {
  comparisonData?: ChartPoint[];
  series: ChartSeries[];
}): ChartPoint[] => {
  return [...series.flatMap((entry) => entry.data), ...comparisonData];
};

export const getAxisPoints = ({
  comparisonData = [],
  series,
}: {
  comparisonData?: ChartPoint[];
  series: ChartSeries[];
}): ChartPoint[] => {
  const pointsByLabel = new Map<string, ChartPoint>();
  for (const point of getAllSeriesPoints({comparisonData, series})) {
    if (!pointsByLabel.has(point.label)) {
      pointsByLabel.set(point.label, point);
    }
  }
  return [...pointsByLabel.values()];
};
