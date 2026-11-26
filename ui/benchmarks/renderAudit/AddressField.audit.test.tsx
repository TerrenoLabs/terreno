import {describe, expect, it} from "bun:test";

import {AddressField} from "../../src/AddressField";
import type {AddressFieldProps} from "../../src/Common";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const value = {
  address1: "123 Main St",
  address2: "Apt 4B",
  city: "Springfield",
  countyCode: "17167",
  countyName: "Sangamon",
  state: "IL",
  zipcode: "62701",
};
const noop = (): void => {};
const baseline: AddressFieldProps = {
  includeCounty: true,
  onBlur: noop,
  onChange: noop,
  testID: "addr",
  value,
};

describe("AddressField renders", () => {
  it("re-renders only the field whose text changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: AddressField,
      changes: {
        "city typed": {...baseline, value: {...value, city: "Springfiel"}},
        "new equal value": {...baseline, value: {...value}},
        "new onChange identity": {...baseline, onChange: (): void => {}},
      },
      name: "AddressField",
    });

    expect(componentStat(report, "city typed", "AddressTextField")?.updates).toBe(1);
    expect(componentStat(report, "city typed", "AddressStateField")).toBeUndefined();
    for (const step of ["same props", "new equal value", "new onChange identity"]) {
      expect(componentStat(report, step, "AddressTextField")).toBeUndefined();
      expect(componentStat(report, step, "AddressStateField")).toBeUndefined();
    }
  });
});
