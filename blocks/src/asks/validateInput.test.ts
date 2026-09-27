import {describe, expect, it} from "bun:test";
import {invalidAskFixtures, validAskFixtures} from "../tests/askFixtures";
import type {AskKind} from "./schema";
import {validateAskInput} from "./validateInput";

const TWO_OPTIONS = [
  {id: "yes", label: "Yes"},
  {id: "no", label: "No"},
];

describe("validateAskInput golden fixtures", () => {
  it("has fixtures in both folders", () => {
    expect(validAskFixtures().length).toBeGreaterThanOrEqual(10);
    expect(invalidAskFixtures().length).toBeGreaterThanOrEqual(20);
  });

  for (const fixture of validAskFixtures()) {
    it(`accepts valid/${fixture.name}`, () => {
      expect(validateAskInput({input: fixture.input, kind: fixture.kind})).toEqual([]);
    });
  }

  for (const fixture of invalidAskFixtures()) {
    it(`rejects invalid/${fixture.name} with exactly the expected errors`, () => {
      const errors = validateAskInput({input: fixture.input, kind: fixture.kind});
      expect(errors.map(({code, path}) => ({code, path}))).toEqual(fixture.errors);
    });
  }
});

describe("validateAskInput messages", () => {
  it("explains an unknown key and how to remove it", () => {
    expect(
      validateAskInput({
        input: {icon: "star", options: TWO_OPTIONS, prompt: "Continue?", select: "one"},
        kind: "choice",
      })
    ).toEqual([
      {
        code: "UNKNOWN_KEY",
        fix: 'Remove "icon".',
        message: '"icon" is not a field of this object.',
        path: "icon",
      },
    ]);
  });

  it("names the first option that used a duplicated id", () => {
    expect(
      validateAskInput({
        input: {
          options: [
            {id: "yes", label: "Yes"},
            {id: "yes", label: "Yes please"},
          ],
          prompt: "Continue?",
          select: "one",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "DUPLICATE_ID",
        fix: "Give every option a unique id.",
        message: 'Option id "yes" is already used by options[0].',
        path: "options[1].id",
      },
    ]);
  });

  it("gives the length limit in TOO_LONG", () => {
    expect(
      validateAskInput({
        input: {options: TWO_OPTIONS, prompt: "x".repeat(501), select: "one"},
        kind: "choice",
      })
    ).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten prompt to 500 characters or fewer.",
        message: "prompt is longer than 500 characters.",
        path: "prompt",
      },
    ]);
  });

  it("describes the expected and received types", () => {
    expect(
      validateAskInput({
        input: {allowDecline: "no", options: TWO_OPTIONS, prompt: "Continue?", select: "one"},
        kind: "choice",
      })
    ).toEqual([
      {
        code: "INVALID_TYPE",
        fix: "Make allowDecline true or false.",
        message: "allowDecline must be true or false, not a string.",
        path: "allowDecline",
      },
    ]);
  });

  it("says where a missing field belongs", () => {
    expect(
      validateAskInput({
        input: {
          options: [{id: "yes"}, {id: "no", label: "No"}],
          prompt: "Continue?",
          select: "one",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "MISSING_REQUIRED",
        fix: 'Add "label" to options[0].',
        message: "options[0].label is required.",
        path: "options[0].label",
      },
    ]);
  });

  it("quotes the rejected value for INVALID_ENUM and INVALID_FORMAT", () => {
    expect(
      validateAskInput({
        input: {
          options: [
            {id: "Yes", label: "Yes"},
            {id: "no", label: "No"},
          ],
          prompt: "Continue?",
          select: "all",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "INVALID_FORMAT",
        fix: 'Use 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit.',
        message: 'options[0].id "Yes" is not a valid option id.',
        path: "options[0].id",
      },
      {
        code: "INVALID_ENUM",
        fix: 'Use "one".',
        message: 'select must be "one", not "all".',
        path: "select",
      },
    ]);
  });

  it("sorts array indexes numerically", () => {
    const options = Array.from({length: 12}, (_, index) => ({
      id: `o${index}`,
      label: `Option ${index}`,
    }));
    options[2] = {id: "o0", label: "Again"};
    options[10] = {id: "o0", label: "Once more"};
    const errors = validateAskInput({
      input: {options, prompt: "Pick.", select: "one"},
      kind: "choice",
    });
    expect(errors.map((error) => error.path)).toEqual(["options[2].id", "options[10].id"]);
  });
});

describe("validateAskInput option id limits", () => {
  it("accepts a 64-character id and rejects a 65-character id", () => {
    const withId = (id: string): unknown => ({
      options: [
        {id, label: "Long"},
        {id: "short", label: "Short"},
      ],
      prompt: "Pick.",
      select: "one",
    });
    expect(validateAskInput({input: withId("a".repeat(64)), kind: "choice"})).toEqual([]);
    expect(
      validateAskInput({input: withId("a".repeat(65)), kind: "choice"}).map((error) => error.code)
    ).toEqual(["INVALID_FORMAT"]);
  });

  it("accepts digits, underscores, and dashes after the first character", () => {
    expect(
      validateAskInput({
        input: {
          options: [
            {id: "9to5", label: "Nine to five"},
            {id: "night_shift-2", label: "Night shift"},
          ],
          prompt: "Pick a shift.",
          select: "one",
        },
        kind: "choice",
      })
    ).toEqual([]);
  });
});

describe("validateAskInput kinds", () => {
  it("throws for a kind outside the catalog", () => {
    expect(() => validateAskInput({input: {}, kind: "signature" as unknown as AskKind})).toThrow(
      'Unknown ask kind "signature".'
    );
  });
});
