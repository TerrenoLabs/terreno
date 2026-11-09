import {describe, expect, it} from "bun:test";

import {getBarLayout, MARK_HIT_SIZE} from "./bars";

const yIdentity = (value: number): number => {
  return 100 - value;
};

describe("getBarLayout", () => {
  it("draws a positive bar from the value down to the zero baseline", () => {
    const layout = getBarLayout({
      barWidth: 20,
      baselineY: 100,
      value: 40,
      xCenter: 50,
      y: yIdentity,
    });

    expect(layout.x).toBe(40);
    expect(layout.y).toBe(60);
    expect(layout.width).toBe(20);
    expect(layout.height).toBe(40);
  });

  it("draws a negative bar from the zero baseline down to the value", () => {
    const layout = getBarLayout({
      barWidth: 20,
      baselineY: 40,
      value: -20,
      xCenter: 50,
      y: yIdentity,
    });

    expect(layout.x).toBe(40);
    expect(layout.y).toBe(40);
    expect(layout.width).toBe(20);
    expect(layout.height).toBe(80);
  });

  it("omits a zero-value bar and keeps a pressable hit target on the baseline", () => {
    const layout = getBarLayout({
      barWidth: 8,
      baselineY: 100,
      value: 0,
      xCenter: 50,
      y: yIdentity,
    });

    expect(layout.height).toBe(0);
    expect(layout.y).toBe(100);
    expect(layout.hitWidth).toBe(MARK_HIT_SIZE);
    expect(layout.hitHeight).toBe(MARK_HIT_SIZE);
    expect(layout.hitX).toBe(50 - MARK_HIT_SIZE / 2);
    expect(layout.hitY).toBe(100 - MARK_HIT_SIZE / 2);
  });
});
