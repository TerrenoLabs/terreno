import {arc, area, line} from "d3-shape";

import type {ChartPoint, ChartScales} from "./types/chartTypes";

export const getLinePath = ({
  points,
  scales,
}: {
  points: ChartPoint[];
  scales: ChartScales;
}): string => {
  if (points.length === 0) {
    return "";
  }

  const path = line<ChartPoint>()
    .x((point) => scales.xCenter(point.label))
    .y((point) => scales.y(point.value))(points);

  return path ?? "";
};

export const getAreaPath = ({
  baselineY,
  points,
  scales,
}: {
  baselineY: number;
  points: ChartPoint[];
  scales: ChartScales;
}): string => {
  if (points.length === 0) {
    return "";
  }

  const path = area<ChartPoint>()
    .x((point) => scales.xCenter(point.label))
    .y0(baselineY)
    .y1((point) => scales.y(point.value))(points);

  return path ?? "";
};

export const getDonutSlicePath = ({
  endAngle,
  innerRadius,
  outerRadius,
  startAngle,
}: {
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
}): string => {
  if (startAngle === endAngle || outerRadius <= 0) {
    return "";
  }

  const path = arc()({
    endAngle,
    innerRadius,
    outerRadius,
    startAngle,
  });

  return path ?? "";
};

const TAU = Math.PI * 2;

export const getDonutSliceAngles = (
  data: {value: number}[]
): Array<{end: number; start: number}> => {
  const total = data.reduce((sum, point) => sum + Math.max(point.value, 0), 0);
  let cursor = 0;

  return data.map((point) => {
    const sweep = total === 0 ? 0 : (Math.max(point.value, 0) / total) * TAU;
    const start = cursor;
    cursor += sweep;
    return {end: cursor, start};
  });
};

/** d3-shape `arc` treats 0 as 12 o'clock by subtracting π/2 before cos/sin. */
export const getDonutSliceHitCenter = ({
  center,
  hitRadius,
  midAngle,
}: {
  center: number;
  hitRadius: number;
  midAngle: number;
}): {x: number; y: number} => {
  const paintAngle = midAngle - Math.PI / 2;
  return {
    x: center + Math.cos(paintAngle) * hitRadius,
    y: center + Math.sin(paintAngle) * hitRadius,
  };
};
