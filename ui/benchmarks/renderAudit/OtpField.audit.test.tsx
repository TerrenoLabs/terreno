import {describe, expect, it} from "bun:test";

import {OtpField} from "../../src/OtpField";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const handleChange = (): void => {};
const handleComplete = (): void => {};
const baseline = {
  length: 8,
  onChange: handleChange,
  onComplete: handleComplete,
  title: "Code",
  value: "12",
};

describe("OtpField renders", () => {
  it("re-renders only the cells a typed digit changes", async () => {
    const report = await auditComponent({
      baseline,
      Component: OtpField,
      changes: {
        "error shown": {...baseline, errorText: "Wrong code"},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "new onComplete identity": {...baseline, onComplete: (): void => {}},
        "one digit typed": {...baseline, value: "123"},
      },
      name: "OtpField",
    });
    // The cell that took the digit, and the cell that became the tab stop.
    expect(componentStat(report, "one digit typed", "OtpCell")?.updates).toBe(2);
    expect(componentStat(report, "new onChange identity", "OtpCell")).toBeUndefined();
    expect(componentStat(report, "new onComplete identity", "OtpCell")).toBeUndefined();
    expect(componentStat(report, "same props", "OtpCell")).toBeUndefined();
  });
});
