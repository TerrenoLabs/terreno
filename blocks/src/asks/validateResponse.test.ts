import {describe, expect, it} from "bun:test";
import type {ChoiceAskInput} from "./schema";
import {validateAskResponse} from "./validateResponse";

const PLAN_INPUT: ChoiceAskInput = {
  default: ["team"],
  options: [
    {description: "$0, one seat", id: "starter", label: "Starter"},
    {description: "$20 per seat", id: "team", label: "Team"},
    {id: "enterprise", label: "Enterprise"},
  ],
  prompt: "Which plan should I set up?",
  select: "one",
};

const REQUIRED_INPUT: ChoiceAskInput = {...PLAN_INPUT, allowDecline: false};

const check = (response: unknown, input: ChoiceAskInput = PLAN_INPUT) =>
  validateAskResponse({input, kind: "choice", response});

const codesAndPaths = (response: unknown, input: ChoiceAskInput = PLAN_INPUT) =>
  check(response, input).map(({code, path}) => ({code, path}));

describe("validateAskResponse accepts valid answers", () => {
  it("accepts one offered option", () => {
    expect(check({action: "accept", content: {selected: ["team"]}})).toEqual([]);
  });

  it("accepts decline when allowDecline is unset", () => {
    expect(check({action: "decline"})).toEqual([]);
  });

  it("accepts cancel with or without a reason, even when decline is not allowed", () => {
    expect(check({action: "cancel"}, REQUIRED_INPUT)).toEqual([]);
    expect(check({action: "cancel", reason: "one_ask_at_a_time"}, REQUIRED_INPUT)).toEqual([]);
  });
});

describe("validateAskResponse error codes", () => {
  it("OPTION_NOT_OFFERED for an id the ask did not offer", () => {
    expect(check({action: "accept", content: {selected: ["gold"]}})).toEqual([
      {
        code: "OPTION_NOT_OFFERED",
        fix: "Use the id of one of the ask's options.",
        message: '"gold" is not one of the offered options.',
        path: "content.selected[0]",
      },
    ]);
  });

  it("OPTION_NOT_OFFERED shortens a very long id in the message", () => {
    const [error] = check({action: "accept", content: {selected: ["x".repeat(100)]}});
    expect(error?.message).toBe(`"${"x".repeat(39)}…" is not one of the offered options.`);
  });

  it("SELECTION_COUNT when select one gets two ids", () => {
    expect(check({action: "accept", content: {selected: ["team", "starter"]}})).toEqual([
      {
        code: "SELECTION_COUNT",
        fix: "Send exactly one option id in content.selected.",
        message: "Choose exactly one option; the answer selects 2.",
        path: "content.selected",
      },
    ]);
  });

  it("SELECTION_COUNT when select one gets no ids", () => {
    expect(codesAndPaths({action: "accept", content: {selected: []}})).toEqual([
      {code: "SELECTION_COUNT", path: "content.selected"},
    ]);
  });

  it("reports the count before the ids that were not offered", () => {
    expect(codesAndPaths({action: "accept", content: {selected: ["team", "gold"]}})).toEqual([
      {code: "SELECTION_COUNT", path: "content.selected"},
      {code: "OPTION_NOT_OFFERED", path: "content.selected[1]"},
    ]);
  });

  it("DECLINE_NOT_ALLOWED when allowDecline is false", () => {
    expect(check({action: "decline"}, REQUIRED_INPUT)).toEqual([
      {
        code: "DECLINE_NOT_ALLOWED",
        fix: 'Answer with action "accept".',
        message: "This ask cannot be skipped.",
        path: "action",
      },
    ]);
  });

  it("INVALID_ENUM for an unknown action", () => {
    expect(check({action: "maybe"})).toEqual([
      {
        code: "INVALID_ENUM",
        fix: 'Use one of "accept", "decline", "cancel".',
        message: 'action must be one of "accept", "decline", "cancel", not "maybe".',
        path: "action",
      },
    ]);
  });

  it("MISSING_REQUIRED for a missing action, content, or selected", () => {
    expect(codesAndPaths({})).toEqual([{code: "MISSING_REQUIRED", path: "action"}]);
    expect(codesAndPaths({action: "accept"})).toEqual([
      {code: "MISSING_REQUIRED", path: "content"},
    ]);
    expect(check({action: "accept", content: {}})).toEqual([
      {
        code: "MISSING_REQUIRED",
        fix: 'Add "selected" to content.',
        message: "content.selected is required.",
        path: "content.selected",
      },
    ]);
  });

  it("INVALID_TYPE for a non-object answer and for non-list or non-string selections", () => {
    expect(codesAndPaths("team")).toEqual([{code: "INVALID_TYPE", path: ""}]);
    expect(check({action: "accept", content: {selected: "team"}})).toEqual([
      {
        code: "INVALID_TYPE",
        fix: "Make content.selected a list.",
        message: "content.selected must be a list, not a string.",
        path: "content.selected",
      },
    ]);
    expect(codesAndPaths({action: "accept", content: {selected: [7]}})).toEqual([
      {code: "INVALID_TYPE", path: "content.selected[0]"},
    ]);
  });

  it("UNKNOWN_KEY for extra fields on the envelope or the content", () => {
    expect(codesAndPaths({action: "decline", content: {selected: ["team"]}})).toEqual([
      {code: "UNKNOWN_KEY", path: "content"},
    ]);
    expect(codesAndPaths({action: "accept", content: {other: "Gold", selected: ["team"]}})).toEqual(
      [{code: "UNKNOWN_KEY", path: "content.other"}]
    );
  });

  it("TOO_LONG and TOO_SHORT for a cancel reason", () => {
    expect(codesAndPaths({action: "cancel", reason: "r".repeat(201)})).toEqual([
      {code: "TOO_LONG", path: "reason"},
    ]);
    expect(codesAndPaths({action: "cancel", reason: " "})).toEqual([
      {code: "TOO_SHORT", path: "reason"},
    ]);
  });

  it("TOO_MANY when an answer lists more ids than any ask can offer", () => {
    const selected = Array.from({length: 51}, (_, index) => `id-${index}`);
    expect(codesAndPaths({action: "accept", content: {selected}})).toEqual([
      {code: "TOO_MANY", path: "content.selected"},
    ]);
  });
});
