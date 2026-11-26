import {describe, expect, it} from "bun:test";

import {ChartFrame, type ChartFrameProps} from "../../src/charts/ChartFrame";
import {Text} from "../../src/Text";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const legendItems = Array.from({length: 8}, (_, index) => ({color: "#123456", label: `S${index}`}));
const children = <Text>plot</Text>;
const baseline: ChartFrameProps = {
  children,
  emptyText: "No data",
  isEmpty: false,
  legendItems,
  testID: "chart",
};

describe("ChartFrame renders", () => {
  it("keeps the legend still while the tooltip and plot change", async () => {
    const report = await auditComponent({
      baseline,
      Component: ChartFrame,
      changes: {
        "new children": {...baseline, children: <Text>plot</Text>},
        "new legendItems array": {...baseline, legendItems: [...legendItems]},
        "tooltip text": {...baseline, tooltipText: "Jan: 12"},
      },
      name: "ChartFrame",
    });
    for (const step of ["same props", "new children", "new legendItems array", "tooltip text"]) {
      expect(componentStat(report, step, "ChartLegendItem")).toBeUndefined();
    }
  });
});
