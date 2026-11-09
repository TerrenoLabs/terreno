import type {TerrenoTheme} from "../Common";

export interface ChartPaint {
  axis: string;
  grid: string;
  series: string;
  seriesFill: string;
  slices: string[];
}

export const getChartPaint = (theme: TerrenoTheme): ChartPaint => {
  return {
    axis: theme.text.secondaryDark,
    grid: theme.border.default,
    series: theme.surface.primary,
    seriesFill: theme.surface.primary,
    slices: [
      theme.surface.primary,
      theme.surface.secondaryDark,
      theme.text.accent,
      theme.surface.error,
    ],
  };
};
