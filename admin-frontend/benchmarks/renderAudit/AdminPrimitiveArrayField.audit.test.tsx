import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {AdminPrimitiveArrayField} from "../../src/AdminPrimitiveArrayField";

const value = Array.from({length: 8}, (_, index) => `tag-${index}`);
const handleChange = (): void => {};
const baseline = {itemType: "string", onChange: handleChange, title: "Tags", value};

describe("AdminPrimitiveArrayField renders", () => {
  it("re-renders only the item whose value changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: AdminPrimitiveArrayField,
      changes: {
        "equal value array": {...baseline, value: [...value]},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "one item edited": {
          ...baseline,
          value: value.map((item, index) => (index === 3 ? "tag-3x" : item)),
        },
      },
      name: "AdminPrimitiveArrayField",
    });

    expect(componentStat(report, "one item edited", "PrimitiveArrayItem")?.updates).toBe(1);
    expect(componentStat(report, "one item edited", "TextField")?.updates).toBe(1);
    expect(componentStat(report, "new onChange identity", "PrimitiveArrayItem")).toBeUndefined();
    expect(componentStat(report, "equal value array", "PrimitiveArrayItem")).toBeUndefined();
    expect(componentStat(report, "same props", "PrimitiveArrayItem")).toBeUndefined();
  });
});
