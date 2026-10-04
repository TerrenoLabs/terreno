import {describe, it} from "bun:test";
import {assert} from "chai";

import {buildReviewPanels} from "./reviewPanels";

describe("buildReviewPanels", () => {
  it("maps declared variables into the given panel", () => {
    const panels = buildReviewPanels({
      input: {name: "Ada", value: "fallback"},
      output: {answer: "4"},
      outputSchema: {
        properties: {answer: {type: "string"}},
        type: "object",
      },
      variables: [{key: "name", label: "Name", required: true, reviewerNote: "Who asked?"}],
    });

    assert.deepEqual(panels.given, [
      {key: "name", label: "Name", note: "Who asked?", value: "Ada"},
    ]);
    assert.deepEqual(panels.wrote, [{key: "answer", label: "answer", note: undefined, value: "4"}]);
  });

  it("falls back to raw input keys and scalar output values", () => {
    const panels = buildReviewPanels({
      input: "plain text",
      output: "plain answer",
    });

    assert.deepEqual(panels.given, [{key: "value", label: "value", value: "plain text"}]);
    assert.deepEqual(panels.wrote, [
      {key: "value", label: "value", note: undefined, value: "plain answer"},
    ]);
  });
});
