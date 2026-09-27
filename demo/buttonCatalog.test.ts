import {describe, it} from "bun:test";
import {assert} from "chai";

import {ButtonConfiguration} from "./story-config/Button.config";
import {catalogIssues, storiesForDemo, unresolvedRelated} from "./catalogContract";
import {DemoConfig} from "./demoConfig";

describe("Button catalog", () => {
  it("ships a copyable usage snippet and resolvable related components", () => {
    assert.include(ButtonConfiguration.usageExample, 'import {Button} from "@terreno/ui"');
    const names = DemoConfig.map((config) => config.name);
    assert.deepEqual(unresolvedRelated(ButtonConfiguration.related, names), []);
    assert.deepEqual(
      catalogIssues(DemoConfig).filter((issue) => issue.startsWith("Button related")),
      []
    );
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
