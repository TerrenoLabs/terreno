import {describe, expect, it} from "bun:test";
import {sortColumnToTraceSort, traceSortToSortColumn} from "./traceTableSort";

describe("traceTableSort", () => {
  it("maps trace sort query values to DataTable column sort state", () => {
    expect(traceSortToSortColumn("-startedAt")).toEqual({column: 3, direction: "desc"});
    expect(traceSortToSortColumn("cost")).toEqual({column: 9, direction: "asc"});
    expect(traceSortToSortColumn("created")).toBeUndefined();
  });

  it("maps DataTable column sort back to trace sort query values", () => {
    expect(sortColumnToTraceSort({column: 9, direction: "desc"}, "-startedAt")).toBe("-cost");
    expect(sortColumnToTraceSort({column: 8, direction: "asc"}, "-startedAt")).toBe("tokens");
    expect(sortColumnToTraceSort({column: 10, direction: "asc"}, "cost")).toBe("latency");
    expect(sortColumnToTraceSort({column: 1, direction: "asc"}, "cost")).toBe("status");
    expect(sortColumnToTraceSort({column: 2, direction: "asc"}, "cost")).toBe("name");
    expect(sortColumnToTraceSort({column: 7, direction: "desc"}, "cost")).toBe("-spans");
    expect(sortColumnToTraceSort({column: 11, direction: "desc"}, "cost")).toBe("-scores");
    expect(sortColumnToTraceSort({column: 5, direction: "asc"}, "cost")).toBe("cost");
    expect(sortColumnToTraceSort(undefined, "-cost")).toBe("-startedAt");
    expect(sortColumnToTraceSort(undefined, "-startedAt")).toBe("startedAt");
  });
});
