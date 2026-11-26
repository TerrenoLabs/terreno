import {describe, expect, it} from "bun:test";

import type {DataTableProps} from "../../src/Common";
import {DataTable} from "../../src/DataTable";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const columns: DataTableProps["columns"] = [
  {columnType: "text", sortable: true, title: "Name", width: 150},
  {columnType: "number", sortable: true, title: "Age", width: 100},
  {columnType: "boolean", title: "Active", width: 100},
  {columnType: "date", title: "Joined", width: 150},
];
const buildData = (): DataTableProps["data"] =>
  Array.from({length: 8}, (_, index) => [
    {value: `Person ${index}`},
    {value: 20 + index},
    {value: index % 2 === 0},
    {value: "2026-01-02T15:04:00.000Z"},
  ]);
const data = buildData();
const changedData = data.map((row, index) =>
  index === 2 ? [{value: "Renamed"}, ...row.slice(1)] : row
);
const baseline: DataTableProps = {
  columns,
  data,
  onSearchChange: (): void => {},
  page: 1,
  search: "",
  searchFields: ["name"],
  setPage: (): void => {},
  setSortColumn: (): void => {},
  sortColumn: undefined,
  totalPages: 5,
};

describe("DataTable renders", () => {
  it("re-renders only the changed row, and the header only when sort changes", async () => {
    const report = await auditComponent({
      baseline,
      Component: DataTable,
      changes: {
        "new columns array": {...baseline, columns: [...columns]},
        "new data array, same rows": {...baseline, data: [...data]},
        "new onSearchChange identity": {...baseline, onSearchChange: (): void => {}},
        "new searchFields array": {...baseline, searchFields: ["name"]},
        "new setPage identity": {...baseline, setPage: (): void => {}},
        "new setSortColumn identity": {...baseline, setSortColumn: (): void => {}},
        "one row changed": {...baseline, data: changedData},
        "page 1 to 2": {...baseline, page: 2},
        "search typed": {...baseline, search: "per"},
        "sort column set": {...baseline, sortColumn: {column: 0, direction: "asc"}},
      },
      name: "DataTable",
    });
    expect(componentStat(report, "one row changed", "DataTableRow")?.updates).toBe(1);
    expect(componentStat(report, "one row changed", "DataTableHeaderCell")).toBeUndefined();
    expect(componentStat(report, "new data array, same rows", "DataTableRow")).toBeUndefined();
    expect(componentStat(report, "search typed", "DataTableRow")).toBeUndefined();
    expect(componentStat(report, "search typed", "DataTableHeaderCell")).toBeUndefined();
    expect(componentStat(report, "page 1 to 2", "DataTableHeaderCell")).toBeUndefined();
    expect(
      componentStat(report, "new setSortColumn identity", "DataTableHeaderCell")
    ).toBeUndefined();
    expect(componentStat(report, "sort column set", "DataTableHeaderCell")?.updates).toBe(4);
  });
});
