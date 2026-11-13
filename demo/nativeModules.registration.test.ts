import {describe, it} from "bun:test";
import {assert} from "chai";

import {findDemoConfig, ListedDemoConfig} from "./demoConfig";

// Baseline rows are covered by nativeModuleBaseline.test.ts, which stays free of demoConfig
// so it runs without the generated ui-types-documentation.json.
describe("native modules diagnostics story", () => {
  it("is reachable by name but hidden from the catalog lists", () => {
    const config = findDemoConfig("Native Modules");
    assert.equal(config?.name, "Native Modules");
    assert.isTrue(config?.hidden);
    assert.isFalse(ListedDemoConfig.some((listed) => listed.name === "Native Modules"));
  });
});
