import {describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "./clientTable";

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
  it("sorts numbers, dates, text, and booleans with blanks last in both directions", () => {
    interface SortRow {
      flag: boolean;
      id: string;
      value?: number | string;
    }
    const sortColumns: ClientTableColumn<SortRow>[] = [
      {key: "value", title: "Value", value: (row) => row.value, width: 80},
      {key: "flag", title: "Flag", value: (row) => row.flag, width: 80},
    ];
    const sortedIds = (rows: SortRow[], column: number, direction: "asc" | "desc"): string[] => {
      const {result} = renderHook(() => useClientTable({columns: sortColumns, rows}));
      act(() => {
        result.current.setSortColumn({column, direction});
      });
      return result.current.rows.map((row) => row.id);
    };
    const numbers = [
      {flag: true, id: "ten", value: 10},
      {flag: false, id: "blank"},
      {flag: true, id: "two", value: 2},
    ];
    expect(sortedIds(numbers, 0, "asc")).toEqual(["two", "ten", "blank"]);
    expect(sortedIds(numbers, 0, "desc")).toEqual(["ten", "two", "blank"]);
    expect(
      sortedIds(
        [
          {flag: true, id: "v10", value: "v10"},
          {flag: true, id: "v9", value: "v9"},
        ],
        0,
        "asc"
      )
    ).toEqual(["v9", "v10"]);
    expect(
      sortedIds(
        [
          {flag: true, id: "later", value: "2026-01-02T00:00:00.000Z"},
          {flag: true, id: "earlier", value: "2026-01-01T00:00:00.000Z"},
        ],
        0,
        "asc"
      )
    ).toEqual(["earlier", "later"]);
    expect(sortedIds(numbers, 1, "asc")).toEqual(["blank", "ten", "two"]);
  });

  it("filters rows by each filter kind", () => {
    interface FilterRow {
      cost?: number;
      created: string;
      name: string;
      ok: boolean;
      status: string;
    }
    const filterRows: FilterRow[] = [
      {cost: 2, created: "2026-01-03T00:00:00.000Z", name: "alpha", ok: false, status: "ok"},
      {cost: 0.5, created: "2026-01-03T00:00:00.000Z", name: "alfa", ok: false, status: "ok"},
      {created: "2026-01-03T00:00:00.000Z", name: "albert", ok: false, status: "ok"},
      {cost: 3, created: "2026-01-03T00:00:00.000Z", name: "alto", ok: true, status: "ok"},
      {cost: 3, created: "2026-01-03T00:00:00.000Z", name: "alma", ok: false, status: "error"},
      {cost: 3, created: "2026-01-01T00:00:00Z", name: "algo", ok: false, status: "ok"},
      {cost: 3, created: "2026-01-03T00:00:00.000Z", name: "beta", ok: false, status: "ok"},
    ];
    const filterColumns: ClientTableColumn<FilterRow>[] = [
      {filter: {kind: "text"}, key: "name", title: "Name", value: (row) => row.name, width: 80},
      {
        filter: {kind: "numberRange"},
        key: "cost",
        title: "Cost",
        value: (row) => row.cost,
        width: 80,
      },
      {filter: {kind: "boolean"}, key: "ok", title: "OK", value: (row) => row.ok, width: 80},
      {
        filter: {kind: "choice"},
        key: "status",
        title: "Status",
        value: (row) => row.status,
        width: 80,
      },
      {
        filter: {kind: "dateRange"},
        key: "created",
        title: "Created",
        value: (row) => row.created,
        width: 80,
      },
    ];
    const {result} = renderHook(() => useClientTable({columns: filterColumns, rows: filterRows}));
    expect(result.current.rows).toHaveLength(filterRows.length);
    act(() => {
      result.current.onFilterValuesChange({
        cost: {$gte: 1},
        created_gte: "2026-01-02T00:00:00.000Z",
        name: "AL",
        ok: false,
        other: "ignored",
        status: ["ok"],
      });
    });
    expect(result.current.rows.map((row) => row.name)).toEqual(["alpha"]);
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
