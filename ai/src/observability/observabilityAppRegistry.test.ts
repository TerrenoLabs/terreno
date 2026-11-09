import {describe, it} from "bun:test";
import {assert} from "chai";
import {
  getObservabilityApp,
  type RegisteredObservabilityApp,
  registerObservabilityApp,
  resetObservabilityApp,
} from "./observabilityAppRegistry";

describe("observabilityAppRegistry", () => {
  it("registers and resets the active app", () => {
    const app = {
      control: {
        datasets: "local",
        experiments: "local",
        prompts: "local",
        reviewQueue: "local",
      },
      plugins: [],
      scoreSinks: [],
      traceSinks: [],
    } as RegisteredObservabilityApp;

    registerObservabilityApp(app);
    assert.strictEqual(getObservabilityApp(), app);

    resetObservabilityApp();
    assert.isUndefined(getObservabilityApp());
  });
});
