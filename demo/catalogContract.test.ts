import {describe, it} from "bun:test";
import {assert} from "chai";

import {catalogIssues, controlDefault, matchesDemoSearch, storiesForDemo} from "./catalogContract";

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
    const issues = catalogIssues([
      {
        name: "Button",
        related: ["Cards", "Modal"],
        stories: {},
      },
      {name: "Card", related: [], stories: {}},
      {name: "Modal", related: [], stories: {}},
    ]);
    assert.include(issues.join("\n"), 'Button related "Cards"');
  });

  it("hides stories marked showInDemo false from demo mode", () => {
    const visible = storiesForDemo({
      Hidden: {showInDemo: false},
      Shown: {showInDemo: true},
    });
    assert.deepEqual(Object.keys(visible), ["Shown"]);
  });

  it("matches a name query and a single category", () => {
    const button = {
      category: "Component",
      description: "Buttons allow users to perform actions",
      name: "Button",
    };
    assert.strictEqual(matchesDemoSearch(button, "but", "All"), true);
    assert.strictEqual(matchesDemoSearch(button, "button", "Form"), false);
    assert.strictEqual(matchesDemoSearch(button, "", "Component"), true);
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
