import type {ChartPlot} from "./types/chartTypes";

export const CHART_Y_AXIS_MAX_WIDTH = 40;
export const CHART_X_AXIS_HEIGHT = 18;
export const CHART_ROTATED_X_AXIS_HEIGHT = 72;
export const CHART_FOOTER_ROW_HEIGHT = 18;

const Y_AXIS_WIDTH_RATIO = 0.3;
const PLOT_INSET = 8;
const Y_TICK_HALF_HEIGHT = 7;
const MIN_PLOT_HEIGHT = 40;
const MIN_DONUT_SIZE = 40;
const DONUT_LEGEND_PADDING = 8;
const DONUT_LEGEND_ROW_GAP = 4;

export interface ChartTickStyle {
  [key: string]: unknown;
  left: number;
  position: "absolute";
  top: number;
  width: number;
}

/**
 * Value labels take a share of a narrow chart instead of a fixed gutter, so a chart in a small
 * card keeps a usable plot instead of spending most of its width on the axis.
 */
export const getChartAxisWidth = (chartWidth: number): number => {
  if (chartWidth <= 0) {
    return 0;
  }
  return Math.min(CHART_Y_AXIS_MAX_WIDTH, Math.floor(chartWidth * Y_AXIS_WIDTH_RATIO));
};

/**
 * `height` is the whole chart, not just the drawing, so a chart dropped into a fixed-height slot
 * fits it. The tick row and the tooltip row come out of that budget; the tooltip row is reserved
 * whether or not a tooltip is showing, so hovering never reflows the page.
 */
export const getPlotHeight = ({
  hasLegend,
  height,
  xAxisHeight = CHART_X_AXIS_HEIGHT,
}: {
  hasLegend: boolean;
  height: number;
  xAxisHeight?: number;
}): number => {
  const footer = xAxisHeight + CHART_FOOTER_ROW_HEIGHT * (hasLegend ? 2 : 1);
  const remaining = height - footer;
  if (remaining >= MIN_PLOT_HEIGHT) {
    return remaining;
  }
  return Math.max(remaining, 1);
};

export const getDonutSize = ({
  chartWidth,
  height,
  legendRowCount,
}: {
  chartWidth: number;
  height: number;
  legendRowCount: number;
}): number => {
  const legendGaps = Math.max(legendRowCount - 1, 0) * DONUT_LEGEND_ROW_GAP;
  const legendHeight =
    legendRowCount * CHART_FOOTER_ROW_HEIGHT + DONUT_LEGEND_PADDING * 2 + legendGaps;
  const footer = CHART_FOOTER_ROW_HEIGHT + legendHeight;
  return Math.max(Math.min(chartWidth, height - footer), MIN_DONUT_SIZE);
};

export const getChartPlot = ({
  chartWidth,
  height,
}: {
  chartWidth: number;
  height: number;
}): ChartPlot => {
  return {
    height: Math.max(height - PLOT_INSET * 2, 1),
    left: PLOT_INSET,
    top: PLOT_INSET,
    width: Math.max(chartWidth - getChartAxisWidth(chartWidth) - PLOT_INSET * 2, 1),
  };
};

/**
 * X tick labels are absolutely positioned on their band center. Laying them out in a flow row
 * instead would let a long label set the chart's min-content width and push the plot past its
 * container.
 */
export const getXTickStyle = ({
  bandwidth,
  isRotated = false,
  xCenter,
}: {
  bandwidth: number;
  isRotated?: boolean;
  xCenter: number;
}): ChartTickStyle => {
  const width = isRotated
    ? Math.max(bandwidth * 1.5, CHART_ROTATED_X_AXIS_HEIGHT)
    : Math.max(bandwidth, 1);
  return {
    left: isRotated ? xCenter - bandwidth / 4 : xCenter - width / 2,
    position: "absolute",
    top: 0,
    ...(isRotated ? {transform: [{rotate: "45deg"}], transformOrigin: "left top"} : {}),
    width,
  };
};

export const shouldRotateChartXTicks = ({
  labelCount,
  policy = "auto",
}: {
  labelCount: number;
  policy?: "auto" | "rotate" | "truncate";
}): boolean => {
  if (policy === "rotate") {
    return true;
  }
  if (policy === "truncate") {
    return false;
  }
  return labelCount > 7;
};

export const getYTickStyle = ({axisWidth, y}: {axisWidth: number; y: number}): ChartTickStyle => {
  return {left: 0, position: "absolute", top: y - Y_TICK_HALF_HEIGHT, width: axisWidth};
};
