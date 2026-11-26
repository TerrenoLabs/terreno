import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {LocaleContentEditor} from "../../src/LocaleContentEditor";

const value = {ar: "a", de: "d", en: "Hello", es: "Hola", fr: "f", ja: "j", pt: "p", zh: "z"};
const handleChange = (): void => {};
const baseline = {helperText: "help", onChange: handleChange, title: "Content", value};

describe("LocaleContentEditor renders", () => {
  it("leaves the locale tabs alone while the active locale is edited", async () => {
    const report = await auditComponent({
      baseline,
      Component: LocaleContentEditor,
      changes: {
        "equal value, new object": {...baseline, value: {...value}},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "typed in active locale": {...baseline, value: {...value, ar: "ab"}},
      },
      name: "LocaleContentEditor",
    });
    expect(componentStat(report, "mount", "LocaleTab")?.mounts).toBe(Object.keys(value).length);
    for (const step of [
      "same props",
      "equal value, new object",
      "new onChange identity",
      "typed in active locale",
    ]) {
      expect(componentStat(report, step, "LocaleTab")).toBeUndefined();
    }
  });
});
