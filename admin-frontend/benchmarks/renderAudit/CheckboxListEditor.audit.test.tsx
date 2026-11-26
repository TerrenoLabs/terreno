import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {CheckboxListEditor} from "../../src/CheckboxListEditor";

const items = Array.from({length: 8}, (_, index) => ({
  confirmationPrompt: "",
  label: `Checkbox ${index}`,
  required: index % 2 === 0,
}));
const baseline = {
  helperText: "Shown under the form",
  onChange: (): void => {},
  title: "Checkboxes",
  value: items,
};

describe("CheckboxListEditor renders", () => {
  it("re-renders only the edited checkbox", async () => {
    const report = await auditComponent({
      baseline,
      Component: CheckboxListEditor,
      changes: {
        "new equal value array": {...baseline, value: [...items]},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "one label edited": {
          ...baseline,
          value: items.map((item, index) => (index === 3 ? {...item, label: "Checkbox 3x"} : item)),
        },
      },
      name: "CheckboxListEditor",
    });
    expect(componentStat(report, "mount", "CheckboxItemEditor")?.mounts).toBe(items.length);
    for (const step of ["same props", "new equal value array", "new onChange identity"]) {
      expect(componentStat(report, step, "CheckboxItemEditor")).toBeUndefined();
    }
    expect(componentStat(report, "one label edited", "CheckboxItemEditor")?.updates).toBe(1);
  });
});
