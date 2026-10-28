import {describe, expect, it} from "bun:test";
import {assert} from "chai";

import {createCartesianScales, getYTickValues} from "./scales";
import type {ChartPoint} from "./types/chartTypes";

const FIXTURE_POINTS: ChartPoint[] = [
  {label: "A", value: 0},
  {label: "B", value: 50},
  {label: "C", value: 100},
];

const PLOT = {height: 100, left: 10, top: 0, width: 90};

describe("createCartesianScales", () => {
  it("maps equal bands and inverted y for a 90x100 plot", () => {
    const scales = createCartesianScales({plot: PLOT, points: FIXTURE_POINTS});

    expect(scales.bandwidth).toBe(30);
    expect(scales.xStart("A")).toBe(10);
    expect(scales.xStart("B")).toBe(40);
    expect(scales.xStart("C")).toBe(70);
    expect(scales.xCenter("A")).toBe(25);
    expect(scales.xCenter("B")).toBe(55);
    expect(scales.xCenter("C")).toBe(85);
    expect(scales.y(0)).toBe(100);
    expect(scales.y(100)).toBe(0);
    expect(scales.y(50)).toBe(50);
  });

  it("scales a sparkline to the data range instead of forcing zero", () => {
    const points = [
      {label: "A", value: 100},
      {label: "B", value: 110},
    ];
    const scales = createCartesianScales({
      includeZero: false,
      plot: PLOT,
      points,
    });

    assert.equal(scales.y(100), 100);
    assert.equal(scales.y(110), 0);
  });

  it("uses the explicit shared x labels while scaling all series values on y", () => {
    const points = [
      ...FIXTURE_POINTS,
      ...FIXTURE_POINTS.map((point) => ({...point, value: point.value / 2})),
    ];
    const scales = createCartesianScales({
      plot: PLOT,
      points,
      xLabels: FIXTURE_POINTS.map((point) => point.label),
    });

    assert.equal(scales.bandwidth, 30);
    assert.equal(scales.xCenter("C"), 85);
    assert.equal(scales.y(100), 0);
    assert.equal(scales.y(25), 75);
  });

  it("returns three ticks from the y domain including zero", () => {
    expect(getYTickValues(FIXTURE_POINTS)).toEqual([0, 50, 100]);
  });

  it("anchors all-negative values at zero so bars can grow downward", () => {
    const points: ChartPoint[] = [
      {label: "A", value: -10},
      {label: "B", value: -5},
    ];
    const scales = createCartesianScales({plot: PLOT, points});

    expect(getYTickValues(points)).toEqual([-10, -5, 0]);
    expect(scales.y(0)).toBe(PLOT.top);
    expect(scales.y(-10)).toBe(PLOT.top + PLOT.height);
    expect(scales.y(-5)).toBe(PLOT.top + PLOT.height / 2);
  });

  it("returns no ticks for empty points", () => {
    expect(getYTickValues([])).toEqual([]);
  });

  it("does not throw on empty points", () => {
    const scales = createCartesianScales({plot: PLOT, points: []});

    expect(scales.bandwidth).toBe(0);
    expect(scales.xStart("A")).toBe(PLOT.left);
    expect(scales.xCenter("A")).toBe(PLOT.left);
    expect(scales.y(0)).toBe(PLOT.top + PLOT.height);
  });
});
