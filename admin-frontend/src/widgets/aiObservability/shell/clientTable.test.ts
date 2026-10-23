import {describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type ClientTableColumn,
  compareClientValues,
  distinctChoiceOptions,
  matchesClientFilter,
  useClientTable,
} from "./clientTable";

interface Row {
  cost?: number;
  created: string;
  name: string;
  ok: boolean;
}

const ROWS: Row[] = [
  {cost: 0.5, created: "2026-01-02T00:00:00.000Z", name: "beta", ok: true},
  {cost: 2, created: "2026-01-01T00:00:00.000Z", name: "alpha", ok: false},
  {created: "2026-01-03T00:00:00.000Z", name: "gamma", ok: true},
];

const COLUMNS: ClientTableColumn<Row>[] = [
  {filter: {kind: "text"}, key: "name", title: "Name", value: (row) => row.name, width: 120},
  {filter: {kind: "numberRange"}, key: "cost", title: "Cost", value: (row) => row.cost, width: 80},
  {filter: {kind: "boolean"}, key: "ok", title: "OK", value: (row) => row.ok, width: 60},
  {
    filter: {kind: "dateRange"},
    key: "created",
    title: "Created",
    value: (row) => row.created,
    width: 120,
  },
  {key: "open", title: "", width: 60},
];

describe("clientTable", () => {
  it("compares numbers, dates, and text with blanks last", () => {
    expect(compareClientValues(2, 10)).toBeLessThan(0);
    expect(compareClientValues("v10", "v9")).toBeGreaterThan(0);
    expect(
      compareClientValues("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    ).toBeGreaterThan(0);
    expect(compareClientValues(undefined, 1)).toBeGreaterThan(0);
    expect(compareClientValues(false, true)).toBeLessThan(0);
  });

  it("matches each filter kind", () => {
    const values = {
      cost: {$gte: 1},
      created_gte: "2026-01-02T00:00:00.000Z",
      name: "AL",
      ok: false,
      status: ["ok"],
    };
    expect(matchesClientFilter({field: "name", kind: "text"}, "alpha", values)).toBe(true);
    expect(matchesClientFilter({field: "name", kind: "text"}, "beta", values)).toBe(false);
    expect(matchesClientFilter({field: "cost", kind: "numberRange"}, 2, values)).toBe(true);
    expect(matchesClientFilter({field: "cost", kind: "numberRange"}, undefined, values)).toBe(
      false
    );
    expect(matchesClientFilter({field: "ok", kind: "boolean"}, false, values)).toBe(true);
    expect(matchesClientFilter({field: "status", kind: "choice"}, "error", values)).toBe(false);
    expect(
      matchesClientFilter({field: "created", kind: "dateRange"}, "2026-01-01T00:00:00Z", values)
    ).toBe(false);
    expect(matchesClientFilter({field: "other", kind: "text"}, "x", values)).toBe(true);
  });

  it("lists distinct choice options", () => {
    expect(distinctChoiceOptions(ROWS, (row) => (row.ok ? "yes" : "no"))).toEqual([
      {label: "no", value: "no"},
      {label: "yes", value: "yes"},
    ]);
  });

  it("sorts, filters, and searches loaded rows", () => {
    const {result} = renderHook(() =>
      useClientTable({columns: COLUMNS, rows: ROWS, searchText: (row) => row.name})
    );
    expect(result.current.columns.map((column) => column.sortable)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    act(() => {
      result.current.setSortColumn({column: 1, direction: "desc"});
    });
    expect(result.current.rows.map((row) => row.name)).toEqual(["alpha", "beta", "gamma"]);
    act(() => {
      result.current.onFilterValuesChange({ok: true});
    });
    expect(result.current.rows.map((row) => row.name)).toEqual(["beta", "gamma"]);
    act(() => {
      result.current.onSearchChange?.("gam");
    });
    expect(result.current.data).toEqual([
      [
        {value: "gamma"},
        {value: "—"},
        {value: true},
        {value: "2026-01-03T00:00:00.000Z"},
        {value: "—"},
      ],
    ]);
  });
});
