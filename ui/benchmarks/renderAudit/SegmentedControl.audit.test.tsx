import {describe, expect, it} from "bun:test";

import {SegmentedControl} from "../../src/SegmentedControl";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const items = ["Day", "Week", "Month", "Year"];
const handleChange = (): void => {};
const baseline = {items, onChange: handleChange, selectedIndex: 0};

describe("SegmentedControl renders", () => {
  it("re-renders only the two segments whose selection changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: SegmentedControl,
      changes: {
        "new items array, same labels": {...baseline, items: [...items]},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "selection 0 to 1": {...baseline, selectedIndex: 1},
      },
      name: "SegmentedControl",
    });

    expect(componentStat(report, "selection 0 to 1", "Pressable")?.updates).toBe(2);
    expect(componentStat(report, "new onChange identity", "Pressable")).toBeUndefined();
    expect(componentStat(report, "new items array, same labels", "Pressable")).toBeUndefined();
  });
});
