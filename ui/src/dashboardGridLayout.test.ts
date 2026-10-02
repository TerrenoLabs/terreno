import {afterEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import {Platform} from "react-native";

import {
  getDashboardCellBoxStyle,
  getDashboardCellWidth,
  getDashboardSpanCellBoxStyle,
} from "./dashboardGridLayout";

const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
});

describe("getDashboardCellWidth", () => {
  it("subtracts inter-column gap so three cells fit the row", () => {
    expect(
      getDashboardCellWidth({
        columnCount: 3,
        gapPx: 16,
        rowWidth: 333,
      })
    ).toBe(100);
  });

  it("leaves a pixel of slack when the columns would exactly consume the measured row", () => {
    const columnCount = 3;
    const gapPx = 16;
    const rowWidth = 332;
    const width = getDashboardCellWidth({columnCount, gapPx, rowWidth});

    expect(width).toBe(99);
    expect(width * columnCount + gapPx * (columnCount - 1)).toBeLessThan(rowWidth);
  });

  it("floors fractional widths so the row still fits every column", () => {
    const columnCount = 3;
    const gapPx = 16;
    const rowWidth = 334;
    const width = getDashboardCellWidth({columnCount, gapPx, rowWidth});

    expect(width).toBe(100);
    expect(width * columnCount + gapPx * (columnCount - 1)).toBeLessThan(rowWidth);
  });

  it("uses the full row width for a single column", () => {
    expect(
      getDashboardCellWidth({
        columnCount: 1,
        gapPx: 16,
        rowWidth: 320,
      })
    ).toBe(320);
  });
});

describe("getDashboardCellBoxStyle", () => {
  it("uses calc that subtracts gap before the row is measured on web", () => {
    Platform.OS = "web";

    expect(
      getDashboardCellBoxStyle({
        columnCount: 3,
        gapPx: 16,
        rowWidth: 0,
      }).width
    ).toBe("calc((100% - 32px) / 3)");
  });

  it("adds the internal gap when a measured cell spans two columns", () => {
    assert.deepInclude(
      getDashboardSpanCellBoxStyle({
        columnCount: 4,
        gapPx: 16,
        rowWidth: 332,
        span: 2,
      }),
      {width: 156}
    );
  });

  it("clamps measured spans to the available columns", () => {
    const fullSpan = getDashboardSpanCellBoxStyle({
      columnCount: 4,
      gapPx: 16,
      rowWidth: 332,
      span: 8,
    });
    assert.equal(fullSpan.width, 328);

    const minimumSpan = getDashboardSpanCellBoxStyle({
      columnCount: 4,
      gapPx: 16,
      rowWidth: 332,
      span: 0,
    });
    assert.equal(minimumSpan.width, 70);
  });

  it("uses responsive web calc widths before measurement", () => {
    Platform.OS = "web";

    assert.equal(
      getDashboardSpanCellBoxStyle({
        columnCount: 4,
        gapPx: 16,
        rowWidth: 0,
        span: 2,
      }).width,
      "calc(((100% - 48px) / 4) * 2 + 16px)"
    );
    assert.equal(
      getDashboardSpanCellBoxStyle({
        columnCount: 4,
        gapPx: 16,
        rowWidth: 0,
        span: 4,
      }).width,
      "100%"
    );
  });

  it("falls back to a full-width cell on native, which has no calc", () => {
    Platform.OS = "ios";

    expect(
      getDashboardCellBoxStyle({
        columnCount: 3,
        gapPx: 16,
        rowWidth: 0,
      }).width
    ).toBe("100%");
  });

  it("pins whole-pixel widths once the row is measured", () => {
    Platform.OS = "web";

    expect(
      getDashboardCellBoxStyle({
        columnCount: 3,
        gapPx: 16,
        rowWidth: 333,
      })
    ).toEqual({flexGrow: 0, flexShrink: 0, maxWidth: 100, width: 100});
  });
});
