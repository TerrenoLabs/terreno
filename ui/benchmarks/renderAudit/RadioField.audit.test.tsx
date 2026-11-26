import {describe, expect, it} from "bun:test";

import {RadioField} from "../../src/RadioField";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const options = Array.from({length: 8}, (_, index) => ({
  label: `Option ${index}`,
  value: `option-${index}`,
}));
const handleChange = (): void => {};
const baseline = {onChange: handleChange, options, title: "Pick", value: "option-1"};

describe("RadioField renders", () => {
  it("re-renders only the options whose selection changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: RadioField,
      changes: {
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "new options array": {...baseline, options: options.map((option) => ({...option}))},
        "value changed": {...baseline, value: "option-2"},
      },
      name: "RadioField",
    });

    expect(componentStat(report, "value changed", "RadioOption")?.updates).toBe(2);
    expect(componentStat(report, "new onChange identity", "RadioOption")).toBeUndefined();
    expect(componentStat(report, "new options array", "RadioOption")).toBeUndefined();
    expect(componentStat(report, "same props", "RadioOption")).toBeUndefined();
  });
});
