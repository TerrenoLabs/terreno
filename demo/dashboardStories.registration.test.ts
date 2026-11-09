import {describe, it} from "bun:test";
import {assert} from "chai";

import {findDemoConfig} from "./demoConfig";

describe("dashboard story registration", () => {
  it("registers Scorecard and ChartCard as reachable demo components", () => {
    assert.equal(findDemoConfig("Scorecard")?.name, "Scorecard");
    assert.equal(findDemoConfig("ChartCard")?.name, "ChartCard");
  });
});
