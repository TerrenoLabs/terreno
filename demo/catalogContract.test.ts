import {describe, it} from "bun:test";
import {assert} from "chai";

import {catalogIssues, controlDefault, storiesForDemo, unresolvedRelated} from "./catalogContract";

describe("catalog contract", () => {
  it("uses false when a boolean control has no default", () => {
    assert.strictEqual(controlDefault({type: "boolean"}), false);
  });

  it("uses 0 when a number control has no default", () => {
    assert.strictEqual(controlDefault({type: "number"}), 0);
  });

  it("keeps an explicit default", () => {
    assert.strictEqual(controlDefault({defaultValue: "primary", type: "select"}), "primary");
  });

  it("reports related names that do not match a component", () => {
    assert.deepEqual(unresolvedRelated(["Cards", "Modal"], ["Card", "Modal"]), ["Cards"]);
  });

  it("hides stories marked showInDemo false from demo mode", () => {
    const visible = storiesForDemo({
      Hidden: {showInDemo: false},
      Shown: {showInDemo: true},
    });
    assert.deepEqual(Object.keys(visible), ["Shown"]);
  });

  it("reports an excluded story that has no reason", () => {
    const issues = catalogIssues([
      {
        name: "Button",
        related: [],
        stories: {Multiline: {stability: "exclude"}},
      },
    ]);
    assert.include(issues.join("\n"), "Button / Multiline");
  });
});
