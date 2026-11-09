import {describe, expect, it} from "bun:test";

import {chartPoints, datasetToPoints} from "./datasetToPoints";

const signups = {
  columns: [
    {name: "month", type: "string" as const},
    {name: "count", type: "number" as const},
  ],
  rows: [
    ["Jan", 120],
    ["Feb", 180],
  ],
};

describe("datasetToPoints", () => {
  it("maps x and y and never returns a color", () => {
    const points = datasetToPoints({dataset: signups, x: "month", y: "count"});
    expect(points).toEqual([
      {label: "Jan", value: 120},
      {label: "Feb", value: 180},
    ]);
    expect(points.every((point) => Object.keys(point).sort().join() === "label,value")).toBe(true);
  });

  it("drops a color that arrived on a point", () => {
    expect(chartPoints([{color: "#ff0000", label: "Jan", value: 1}])).toEqual([
      {label: "Jan", value: 1},
    ]);
  });
});
