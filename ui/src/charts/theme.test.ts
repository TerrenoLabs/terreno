import {describe, expect, it} from "bun:test";

import type {TerrenoTheme} from "../Common";
import {getChartPaint} from "./theme";

const THEME = {
  border: {default: "#CDCDCD"},
  surface: {error: "#BD1111", primary: "#0E9DCD", secondaryDark: "#2B6072"},
  text: {accent: "#956A00", secondaryDark: "#543C00"},
} as unknown as TerrenoTheme;

describe("getChartPaint", () => {
  it("maps theme tokens onto series, slices, grid, and axis paints", () => {
    const paint = getChartPaint(THEME);

    expect(paint.series).toBe("#0E9DCD");
    expect(paint.seriesFill).toBe("#0E9DCD");
    expect(paint.slices).toEqual(["#0E9DCD", "#2B6072", "#956A00", "#BD1111"]);
    expect(paint.grid).toBe("#CDCDCD");
    expect(paint.axis).toBe("#543C00");
  });
});
