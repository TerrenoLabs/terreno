import {describe, it} from "bun:test";
import {assert} from "chai";

import {ButtonConfiguration} from "./story-config/Button.config";
import {storiesForDemo} from "./catalogContract";
import {getDemoCatalogIssues} from "./demoConfig";

describe("Button catalog", () => {
  it("ships a copyable usage snippet and resolvable related components", () => {
    assert.include(ButtonConfiguration.usageExample, 'import {Button} from "@terreno/ui"');
    const issues = getDemoCatalogIssues();
    assert.deepEqual(issues.filter((issue) => issue.startsWith("Button related")), []);
    assert.deepEqual(issues.filter((issue) => issue.includes("related")), []);
    assert.deepEqual(issues.filter((issue) => issue.includes("usageExample")), []);
  });

  it("keeps Multiline off the demo page and gives Variants interaction steps", () => {
    assert.strictEqual(ButtonConfiguration.stories.Multiline?.showInDemo, false);
    assert.notInclude(Object.keys(storiesForDemo(ButtonConfiguration.stories)), "Multiline");
    assert.deepEqual(ButtonConfiguration.stories.Variants?.interactions, [
      {action: "expectText", value: "Default/Primary"},
      {action: "press", targetTestID: "button-variant-primary"},
    ]);
  });
});
