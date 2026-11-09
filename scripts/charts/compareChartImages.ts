import pixelmatch from "pixelmatch";
import {PNG} from "pngjs";

export interface ChartImageDiff {
  diffCount: number;
  height: number;
  width: number;
}

const MAX_CHART_VISUAL_DIFF_RATIO = 0.004;

export const diffPngBuffers = ({
  actual,
  expected,
  threshold = 0.1,
}: {
  actual: Buffer;
  expected: Buffer;
  threshold?: number;
}): {diffPng: Buffer; result: ChartImageDiff} => {
  const actualPng = PNG.sync.read(actual);
  const expectedPng = PNG.sync.read(expected);
  if (actualPng.width !== expectedPng.width || actualPng.height !== expectedPng.height) {
    throw new Error(
      `PNG size mismatch: actual ${actualPng.width}x${actualPng.height} vs expected ${expectedPng.width}x${expectedPng.height}`
    );
  }

  const diff = new PNG({height: actualPng.height, width: actualPng.width});
  const diffCount = pixelmatch(
    actualPng.data,
    expectedPng.data,
    diff.data,
    actualPng.width,
    actualPng.height,
    {threshold}
  );

  return {
    diffPng: PNG.sync.write(diff),
    result: {
      diffCount,
      height: actualPng.height,
      width: actualPng.width,
    },
  };
};

export const isChartVisualMatch = ({
  diffCount,
  pixelCount,
}: {
  diffCount: number;
  pixelCount: number;
}): boolean => {
  if (pixelCount <= 0) {
    return false;
  }
  return diffCount / pixelCount <= MAX_CHART_VISUAL_DIFF_RATIO;
};
