import {describe, expect, it} from "bun:test";

import {MultiselectField} from "../../src/MultiselectField";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const options = Array.from({length: 8}, (_, index) => ({
  label: `Option ${index}`,
  value: `option-${index}`,
}));
const value = ["option-1"];
const handleChange = (): void => {};
const baseline = {onChange: handleChange, options, title: "Pick", value};

describe("MultiselectField renders", () => {
  it("re-renders only the option whose selection changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: MultiselectField,
      changes: {
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "one option selected": {...baseline, value: ["option-1", "option-2"]},
      },
      name: "MultiselectField",
    });

    expect(componentStat(report, "one option selected", "Option")?.updates).toBe(1);
    expect(componentStat(report, "new onChange identity", "Option")).toBeUndefined();
    expect(componentStat(report, "same props", "Option")).toBeUndefined();
  });
});
