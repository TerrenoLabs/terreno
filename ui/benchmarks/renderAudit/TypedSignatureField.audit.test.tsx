import {describe, expect, it} from "bun:test";

import type {SignatureFont, TypedSignatureValue} from "../../src/Common";
import {TypedSignatureField} from "../../src/TypedSignatureField";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const fonts: SignatureFont[] = Array.from({length: 8}, (_, index) => ({
  fontFamily: `signature-font-${index}`,
  key: `font-${index}`,
  label: `Font ${index}`,
}));
const value: TypedSignatureValue = {fontKey: "font-1", typedName: "Jane"};
const handleChange = (): void => {};
const baseline = {fonts, onChange: handleChange, value};

describe("TypedSignatureField renders", () => {
  it("re-renders only the font options whose selection changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: TypedSignatureField,
      changes: {
        "font selected": {...baseline, value: {fontKey: "font-2", typedName: "Jane"}},
        "name typed": {...baseline, value: {fontKey: "font-1", typedName: "Jane D"}},
        "new fonts array": {...baseline, fonts: [...fonts]},
        "new onChange identity": {...baseline, onChange: (): void => {}},
      },
      name: "TypedSignatureField",
    });

    expect(componentStat(report, "name typed", "SignatureFontOption")).toBeUndefined();
    expect(componentStat(report, "font selected", "SignatureFontOption")?.updates).toBe(2);
    expect(componentStat(report, "new onChange identity", "SignatureFontOption")).toBeUndefined();
    expect(componentStat(report, "new fonts array", "SignatureFontOption")).toBeUndefined();
    expect(componentStat(report, "same props", "SignatureFontOption")).toBeUndefined();
  });
});
