import {describe, expect, it, mock} from "bun:test";
import {Platform} from "react-native";

import type {DataTableCellData, DataTableColumn} from "./Common";
import {
  createDataTableTextMeasurer,
  DATA_TABLE_AUTO_CUSTOM_CONTENT_WIDTH,
  DATA_TABLE_AUTO_MAX_COLUMN_WIDTH,
  DATA_TABLE_AUTO_MIN_COLUMN_WIDTH,
  DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS,
  DATA_TABLE_CELL_HORIZONTAL_PADDING,
  estimateDataTableTextWidth,
  fitDataTableColumnWidths,
  getDataTableNaturalWidths,
  type MeasureDataTableText,
} from "./dataTableColumnWidths";

// One pixel per character keeps expected widths easy to read.
const measureText: MeasureDataTableText = ({text}) => text.length;
const formatDate = (value: unknown): string => `date:${String(value)}`;
const PAD = DATA_TABLE_CELL_HORIZONTAL_PADDING;

const naturalWidths = (
  columns: DataTableColumn[],
  data: DataTableCellData[][],
  extra: Partial<Parameters<typeof getDataTableNaturalWidths>[0]> = {}
): number[] =>
  getDataTableNaturalWidths({
    columns,
    data,
    defaultTextSize: "md",
    formatDate,
    measureText,
    ...extra,
  });

describe("getDataTableNaturalWidths", () => {
  it("keeps an explicit width", () => {
    const widths = naturalWidths(
      [{columnType: "text", title: "Name", width: 222}],
      [[{value: "x".repeat(500)}]]
    );
    expect(widths).toEqual([222]);
  });

  it("sizes to the content when it is wider than the title", () => {
    const content = "c".repeat(120);
    const widths = naturalWidths([{columnType: "text", title: "Name"}], [[{value: content}]]);
    expect(widths).toEqual([120 + PAD]);
  });

  it("sizes to the title and its header icons when they are wider than the content", () => {
    const title = "t".repeat(100);
    const widths = naturalWidths(
      [{columnType: "text", infoModalText: "Help", sortable: true, title}],
      [[{value: "a"}]]
    );
    // Sort icon (24) and info icon (26) sit next to the title.
    expect(widths).toEqual([100 + 24 + 26 + PAD]);
  });

  it("clamps to the minimum and maximum auto widths", () => {
    const widths = naturalWidths(
      [
        {columnType: "text", title: "A"},
        {columnType: "text", title: "B"},
      ],
      [[{value: "a"}, {value: "b".repeat(2000)}]]
    );
    expect(widths).toEqual([DATA_TABLE_AUTO_MIN_COLUMN_WIDTH, DATA_TABLE_AUTO_MAX_COLUMN_WIDTH]);
  });

  it("measures dates as they are formatted", () => {
    const widths = naturalWidths(
      [{columnType: "date", title: "D"}],
      [[{value: "2026-01-01T00:00:00.000Z".repeat(4)}]]
    );
    expect(widths).toEqual([formatDate("2026-01-01T00:00:00.000Z".repeat(4)).length + PAD]);
  });

  it("gives a custom column a default content width when its value is not text", () => {
    const widths = naturalWidths([{columnType: "pill", title: "P"}], [[{value: {a: 1}}]], {
      customColumnTypes: new Set(["pill"]),
    });
    expect(widths).toEqual([DATA_TABLE_AUTO_CUSTOM_CONTENT_WIDTH + PAD]);
  });

  it("samples at most a fixed number of rows, spread across the data", () => {
    const spy = mock(measureText);
    const data = Array.from({length: 10_000}, (_, index) => [{value: `row ${index}`}]);
    naturalWidths([{columnType: "text", title: "Name"}], data, {measureText: spy});
    // One call for the header, one per sampled row.
    expect(spy).toHaveBeenCalledTimes(DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS + 1);
    const measuredRows = spy.mock.calls.slice(1).map(([args]) => args.text);
    // 10,000 rows / 50 samples = every 200th row, so the last sample is row 9,800.
    expect(measuredRows[0]).toBe("row 0");
    expect(measuredRows.at(-1)).toBe("row 9800");
  });
});

describe("getDataTableNaturalWidths header and cell extras", () => {
  it("makes room for the filter button only on web when filters are wired up", () => {
    const column: DataTableColumn = {
      columnType: "text",
      filter: {field: "status", kind: "text"},
      title: "t".repeat(100),
    };
    const originalOS = Platform.OS;
    try {
      Platform.OS = "web";
      expect(naturalWidths([column], [[{value: "a"}]], {hasFilters: true})).toEqual([
        100 + 40 + PAD,
      ]);
      expect(naturalWidths([column], [[{value: "a"}]], {hasFilters: false})).toEqual([100 + PAD]);
      Platform.OS = "ios";
      expect(naturalWidths([column], [[{value: "a"}]], {hasFilters: true})).toEqual([100 + PAD]);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it("sizes a boolean column to its icon rather than its value", () => {
    const widths = naturalWidths(
      [{columnType: "boolean", title: "B"}],
      [[{value: "a very long value that is never drawn as text"}]]
    );
    expect(widths).toEqual([DATA_TABLE_AUTO_MIN_COLUMN_WIDTH]);
  });

  it("skips missing cells and non-text values in plain columns", () => {
    const widths = naturalWidths([{columnType: "text", title: "T"}], [[], [{value: {a: 1}}]]);
    expect(widths).toEqual([DATA_TABLE_AUTO_MIN_COLUMN_WIDTH]);
  });
});

interface FakeCanvas {
  fonts: string[];
  texts: string[];
  getContext: (kind: string) => unknown;
}

const fakeCanvas = (width: number): FakeCanvas => {
  const canvas: FakeCanvas = {
    fonts: [],
    getContext: () => ({
      set font(value: string) {
        canvas.fonts.push(value);
      },
      measureText: (text: string) => {
        canvas.texts.push(text);
        return {width};
      },
    }),
    texts: [],
  };
  return canvas;
};

describe("createDataTableTextMeasurer", () => {
  const header = {fontSize: 10, isHeader: true, text: "Name"};
  const cell = {fontSize: 16, isHeader: false, text: "Ada Lovelace"};

  it("estimates when not on web", () => {
    const getDocument = mock(() => ({createElement: () => fakeCanvas(99)}));
    const measure = createDataTableTextMeasurer({getDocument, isWeb: () => false});
    expect(measure(cell)).toBe(estimateDataTableTextWidth(cell));
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("measures with one cached canvas on web, using the header and cell fonts", () => {
    const canvas = fakeCanvas(41.2);
    const createElement = mock(() => canvas);
    const measure = createDataTableTextMeasurer({
      getDocument: () => ({createElement}),
      isWeb: () => true,
    });
    expect(measure(header)).toBe(42);
    expect(measure(cell)).toBe(42);
    expect(createElement).toHaveBeenCalledTimes(1);
    expect(canvas.fonts).toEqual([
      "700 10px text-bold, Nunito, sans-serif",
      "400 16px text-regular, Nunito, sans-serif",
    ]);
    // Headers render uppercase, so they are measured that way.
    expect(canvas.texts).toEqual(["NAME", "Ada Lovelace"]);
  });

  it("falls back to the estimate when the canvas is a stub that measures 0", () => {
    const measure = createDataTableTextMeasurer({
      getDocument: () => ({createElement: () => fakeCanvas(0)}),
      isWeb: () => true,
    });
    expect(measure(cell)).toBe(estimateDataTableTextWidth(cell));
    expect(measure({...cell, text: ""})).toBe(0);
  });

  it("estimates when there is no document, no canvas context, or canvas creation throws", () => {
    const noDocument = createDataTableTextMeasurer({
      getDocument: () => undefined,
      isWeb: () => true,
    });
    const noContext = createDataTableTextMeasurer({
      getDocument: () => ({createElement: () => ({})}),
      isWeb: () => true,
    });
    const getDocument = mock(() => ({
      createElement: (): unknown => {
        throw new Error("no canvas");
      },
    }));
    const throwing = createDataTableTextMeasurer({getDocument, isWeb: () => true});
    for (const measure of [noDocument, noContext, throwing]) {
      expect(measure(cell)).toBe(estimateDataTableTextWidth(cell));
    }
    // A failed lookup is cached rather than retried on every cell.
    throwing(cell);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it("defaults to the global document and Platform.OS", () => {
    const measure = createDataTableTextMeasurer();
    expect(measure(cell)).toBeGreaterThan(0);
  });
});

describe("fitDataTableColumnWidths", () => {
  it("keeps natural widths before the container is measured", () => {
    const columns: DataTableColumn[] = [{columnType: "text", title: "A"}];
    expect(fitDataTableColumnWidths({availableWidth: 0, columns, naturalWidths: [100]})).toEqual([
      100,
    ]);
  });

  it("grows auto columns in proportion to fill the container exactly", () => {
    const columns: DataTableColumn[] = [
      {columnType: "text", title: "A"},
      {columnType: "text", title: "B", width: 100},
      {columnType: "text", title: "C"},
    ];
    const widths = fitDataTableColumnWidths({
      availableWidth: 1001,
      columns,
      naturalWidths: [100, 100, 300],
    });
    expect(widths[1]).toBe(100);
    expect(widths[0]).toBe(100 + Math.floor((501 * 100) / 400));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(1001);
  });

  it("keeps natural widths when the columns overflow the container", () => {
    const columns: DataTableColumn[] = [
      {columnType: "text", title: "A"},
      {columnType: "text", title: "B"},
    ];
    expect(
      fitDataTableColumnWidths({availableWidth: 300, columns, naturalWidths: [200, 200]})
    ).toEqual([200, 200]);
  });

  it("never changes explicit widths, even with room to spare", () => {
    const columns: DataTableColumn[] = [{columnType: "text", title: "A", width: 120}];
    expect(fitDataTableColumnWidths({availableWidth: 900, columns, naturalWidths: [120]})).toEqual([
      120,
    ]);
  });
});
