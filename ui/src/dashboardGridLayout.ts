import {Platform} from "react-native";

export interface DashboardCellStyle {
  [key: string]: unknown;
  flexGrow: 0;
  flexShrink: 0;
  maxWidth: number | string;
  width: number | string;
}

export const getDashboardCellWidth = ({
  columnCount,
  gapPx,
  rowWidth,
}: {
  columnCount: number;
  gapPx: number;
  rowWidth: number;
}): number => {
  if (rowWidth <= 0) {
    return 0;
  }
  if (columnCount <= 1) {
    return Math.floor(rowWidth);
  }

  // Floor to whole pixels so columnCount cells plus their gaps can never exceed rowWidth once
  // the browser or Yoga snaps subpixel values, which would wrap the last tile. An exact fit is
  // still unsafe: onLayout rounds a fractional row up, so give the row a pixel of slack.
  const gapTotal = gapPx * (columnCount - 1);
  const width = Math.floor((rowWidth - gapTotal) / columnCount);
  const fitsWithSlack = width * columnCount + gapTotal < rowWidth;
  return Math.max(fitsWithSlack ? width : width - 1, 0);
};

/**
 * Style for one grid cell. Measured rows use whole-pixel widths. Before the first `onLayout`,
 * web falls back to a `calc()` width that subtracts the same gap; native has no `calc`, so cells
 * fill the row for that one frame instead of collapsing to zero.
 */
export const getDashboardCellBoxStyle = ({
  columnCount,
  gapPx,
  rowWidth,
}: {
  columnCount: number;
  gapPx: number;
  rowWidth: number;
}): DashboardCellStyle => {
  return getDashboardSpanCellBoxStyle({columnCount, gapPx, rowWidth, span: 1});
};

export const getDashboardSpanCellBoxStyle = ({
  columnCount,
  gapPx,
  rowWidth,
  span,
}: {
  columnCount: number;
  gapPx: number;
  rowWidth: number;
  span: number;
}): DashboardCellStyle => {
  const safeColumnCount = Math.max(columnCount, 1);
  const safeSpan = Math.min(Math.max(Math.floor(span), 1), safeColumnCount);
  if (rowWidth > 0) {
    const baseWidth = getDashboardCellWidth({
      columnCount: safeColumnCount,
      gapPx,
      rowWidth,
    });
    const width = baseWidth * safeSpan + gapPx * (safeSpan - 1);
    return {flexGrow: 0, flexShrink: 0, maxWidth: width, width};
  }
  if (safeSpan === safeColumnCount || Platform.OS !== "web") {
    return {flexGrow: 0, flexShrink: 0, maxWidth: "100%", width: "100%"};
  }

  const gapTotal = gapPx * (safeColumnCount - 1);
  if (safeSpan === 1) {
    const width = `calc((100% - ${gapTotal}px) / ${safeColumnCount})`;
    return {flexGrow: 0, flexShrink: 0, maxWidth: width, width};
  }
  const internalGaps = gapPx * (safeSpan - 1);
  const width = `calc(((100% - ${gapTotal}px) / ${safeColumnCount}) * ${safeSpan} + ${internalGaps}px)`;
  return {flexGrow: 0, flexShrink: 0, maxWidth: width, width};
};
