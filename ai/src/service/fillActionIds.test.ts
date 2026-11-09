import {describe, it} from "bun:test";
import {validateBlocks} from "@terreno/blocks";
import {assert} from "chai";

import {fillMissingActionIds} from "./fillActionIds";

const JOKE = `v: 1
blocks:
  - type: text
    markdown: Why did the developer quit? Because they couldn't find their MongoDB!
  - type: actions
    elements:
      - type: button
        id: list_todos_button
        text: List all todos
        action:
          kind: reply
          text: list all the todos
`;

describe("fillMissingActionIds", () => {
  it("adds an actions id so a joke with a reply button validates", () => {
    const filled = fillMissingActionIds(JOKE);
    assert.isString(filled);
    const checked = validateBlocks(JSON.parse(filled ?? ""));
    assert.isTrue(checked.ok);
    assert.include(filled, "MongoDB!");
    assert.include(filled, '"id":"actions"');
  });

  it("leaves a document that already has action ids alone", () => {
    const text = `v: 1
blocks:
  - type: actions
    id: row
    elements:
      - type: button
        id: run_btn
        text: Export
        action:
          kind: reply
          text: Export
`;
    assert.isUndefined(fillMissingActionIds(text));
  });

  it("does not reuse an id that a button already has", () => {
    const text = `v: 1
blocks:
  - type: card
    children:
      - type: actions
        elements:
          - type: button
            id: actions
            text: Again
            action:
              kind: reply
              text: Again
`;
    const filled = fillMissingActionIds(text);
    assert.isString(filled);
    assert.include(filled, '"id":"actions_2"');
  });
});
