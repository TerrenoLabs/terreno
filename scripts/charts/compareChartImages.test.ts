import {describe, it} from "bun:test";
import {assert} from "chai";
import {PNG} from "pngjs";

import {diffPngBuffers, isChartVisualMatch} from "./compareChartImages.ts";

const solidPng = ({
  blue,
  green,
  height,
  red,
  width,
}: {
  blue: number;
  green: number;
  height: number;
  red: number;
  width: number;
}): Buffer => {
  const png = new PNG({height, width});
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      png.data[idx] = red;
      png.data[idx + 1] = green;
      png.data[idx + 2] = blue;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

describe("compareChartImages", (): void => {
  it("reports zero diffs for identical buffers", (): void => {
    const png = solidPng({blue: 40, green: 80, height: 8, red: 10, width: 8});
    const {result} = diffPngBuffers({actual: png, expected: png});
    assert.equal(result.diffCount, 0);
    assert.isTrue(isChartVisualMatch({diffCount: result.diffCount, pixelCount: 64}));
  });

  it("counts changed pixels between two solids", (): void => {
    const expected = solidPng({blue: 0, green: 0, height: 4, red: 0, width: 4});
    const actual = solidPng({blue: 255, green: 255, height: 4, red: 255, width: 4});
    const {result} = diffPngBuffers({actual, expected});
    assert.equal(result.diffCount, 16);
    assert.isFalse(isChartVisualMatch({diffCount: result.diffCount, pixelCount: 16}));
  });

  it("throws when dimensions differ", (): void => {
    const expected = solidPng({blue: 0, green: 0, height: 4, red: 0, width: 4});
    const actual = solidPng({blue: 0, green: 0, height: 8, red: 0, width: 4});
    assert.throws(() => {
      diffPngBuffers({actual, expected});
    }, /PNG size mismatch/);
  });
});
