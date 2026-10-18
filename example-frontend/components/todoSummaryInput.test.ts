import {describe, expect, it} from "bun:test";
import {assert} from "chai";

import {buildTodoSummaryInput} from "./todoSummaryInput";

const MAX_SUMMARY_TODOS = 25;

describe("buildTodoSummaryInput", () => {
  it("labels open and done todos", () => {
    const input = buildTodoSummaryInput([
      {completed: false, title: "Write docs"},
      {completed: true, title: "Ship trace UI"},
    ]);
    assert.equal(input, "My todo list:\n- [open] Write docs\n- [done] Ship trace UI");
  });

  it("returns an empty string when nothing has a title", () => {
    expect(buildTodoSummaryInput([])).toBe("");
    expect(buildTodoSummaryInput([{title: "   "}, {completed: true}])).toBe("");
  });

  it("trims titles and caps the number of todos sent to the model", () => {
    const todos = Array.from({length: MAX_SUMMARY_TODOS + 5}, (_unused, index) => ({
      completed: false,
      title: `  Todo ${index}  `,
    }));
    const lines = buildTodoSummaryInput(todos).split("\n");
    assert.equal(lines.length, MAX_SUMMARY_TODOS + 1);
    assert.equal(lines[1], "- [open] Todo 0");
  });
});
