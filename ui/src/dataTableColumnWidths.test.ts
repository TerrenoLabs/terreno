import {describe, expect, it, mock} from "bun:test";

import type {DataTableCellData, DataTableColumn} from "./Common";
import {
  DATA_TABLE_AUTO_CUSTOM_CONTENT_WIDTH,
  DATA_TABLE_AUTO_MAX_COLUMN_WIDTH,
  DATA_TABLE_AUTO_MIN_COLUMN_WIDTH,
  DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS,
  DATA_TABLE_CELL_HORIZONTAL_PADDING,
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
