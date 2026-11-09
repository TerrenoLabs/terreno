export const MARK_HIT_SIZE = 24;

export interface BarLayout {
  height: number;
  hitHeight: number;
  hitWidth: number;
  hitX: number;
  hitY: number;
  width: number;
  x: number;
  y: number;
}

export const getBarLayout = ({
  barWidth,
  baselineY,
  value,
  xCenter,
  y,
}: {
  barWidth: number;
  baselineY: number;
  value: number;
  xCenter: number;
  y: (value: number) => number;
}): BarLayout => {
  const valueY = y(value);
  const x = xCenter - barWidth / 2;
  let rectY = baselineY;
  let rectHeight = 0;
  if (value > 0) {
    rectY = valueY;
    rectHeight = Math.max(baselineY - valueY, 0);
  } else if (value < 0) {
    rectY = baselineY;
    rectHeight = Math.max(valueY - baselineY, 0);
  }

  const hitWidth = Math.max(barWidth, MARK_HIT_SIZE);
  const hitHeight = Math.max(rectHeight, MARK_HIT_SIZE);
  const barMidY = rectHeight === 0 ? baselineY : rectY + rectHeight / 2;

  return {
    height: rectHeight,
    hitHeight,
    hitWidth,
    hitX: xCenter - hitWidth / 2,
    hitY: barMidY - hitHeight / 2,
    width: barWidth,
    x,
    y: rectY,
  };
};
