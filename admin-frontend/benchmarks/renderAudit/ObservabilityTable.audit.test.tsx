import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {
  ObservabilityTable,
  type ObservabilityTableProps,
  type ObservabilityTableRow,
} from "../../src/widgets/aiObservability/shell/ObservabilityTable";

const columns = [
  {minWidth: 200, title: "Input"},
  {title: "Output"},
  {title: "Score"},
  {grow: 2, title: "Trace"},
];
const handleClick = (): void => {};
const buildRows = (changed?: number): ObservabilityTableRow[] =>
  Array.from({length: 8}, (_, index) => ({
    cells: [`input ${index}`, `output ${index}`, index === changed ? 99 : index, `trace-${index}`],
    key: `row-${index}`,
    onClick: handleClick,
  }));
const rows = buildRows();
const baseline: ObservabilityTableProps = {columns, rows, testID: "obs-table"};

describe("ObservabilityTable renders", () => {
  it("skips rows whose cells did not change", async () => {
    const report = await auditComponent({
      baseline,
      Component: ObservabilityTable,
      changes: {
        "new columns array": {...baseline, columns: columns.map((column) => ({...column}))},
        "new onClick identity": {
          ...baseline,
          rows: rows.map((row) => ({...row, onClick: (): void => {}})),
        },
        "new rows array, same row objects": {...baseline, rows: [...rows]},
        "new rows, equal content": {...baseline, rows: buildRows()},
        "one row changed": {...baseline, rows: buildRows(3)},
      },
      name: "ObservabilityTable",
    });

    const row = "ObservabilityTableRow";
    expect(componentStat(report, "mount", row)?.mounts).toBe(8);
    expect(componentStat(report, "same props", row)).toBeUndefined();
    expect(componentStat(report, "new rows array, same row objects", row)).toBeUndefined();
    expect(componentStat(report, "new onClick identity", row)).toBeUndefined();
  });
});
