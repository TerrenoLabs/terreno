import {describe, expect, it} from "bun:test";
import {invalidAskFixtures, validAskFixtures} from "../tests/askFixtures";
import {type AskKind, type AskSurface, isCompactAskKind} from "./schema";
import {validateAskInput} from "./validateInput";

const NO_OPTION = {id: "no", label: "No"};

const TWO_OPTIONS = [{id: "yes", label: "Yes"}, NO_OPTION];

/** What the compact surface returns for each valid fixture, read off the compact rules by hand. */
const COMPACT_ERRORS_BY_FIXTURE: Record<string, {code: string; path: string}[]> = {
  "choice-emoji-label-cut": [{code: "TOO_LONG", path: "options[0].label"}],
  "choice-labels-collide-after-cut": [
    {code: "TOO_LONG", path: "options[0].label"},
    {code: "TOO_LONG", path: "options[1].label"},
  ],
  "choice-long-text-cut": [
    {code: "TOO_LONG", path: "options[0].label"},
    {code: "TOO_LONG", path: "options[1].label"},
  ],
  "choice-many-default-below-min": [
    {code: "UNKNOWN_KEY", path: "maxSelected"},
    {code: "UNKNOWN_KEY", path: "minSelected"},
    {code: "INVALID_ENUM", path: "select"},
  ],
  "choice-many-every-choice-with-other": [
    {code: "UNKNOWN_KEY", path: "allowOther"},
    {code: "UNKNOWN_KEY", path: "maxSelected"},
    {code: "UNKNOWN_KEY", path: "minSelected"},
    {code: "UNKNOWN_KEY", path: "otherLabel"},
    {code: "INVALID_ENUM", path: "select"},
  ],
  "choice-many-no-default": [{code: "INVALID_ENUM", path: "select"}],
  "choice-many-optional-no-buttons": [
    {code: "UNKNOWN_KEY", path: "minSelected"},
    {code: "INVALID_ENUM", path: "select"},
  ],
  "choice-many-options-default-label-collides": [
    {code: "TOO_MANY", path: "options"},
    {code: "TOO_LONG", path: "options[0].label"},
    {code: "TOO_LONG", path: "options[1].label"},
  ],
  "choice-many-options-no-buttons": [{code: "TOO_MANY", path: "options"}],
  "choice-many-options-no-default": [{code: "TOO_MANY", path: "options"}],
  "choice-many-options-with-default": [{code: "TOO_MANY", path: "options"}],
  "choice-many-required-with-default": [
    {code: "TOO_MANY", path: "options"},
    {code: "INVALID_ENUM", path: "select"},
  ],
  "choice-many-single-pick-or-other": [
    {code: "UNKNOWN_KEY", path: "allowOther"},
    {code: "UNKNOWN_KEY", path: "maxSelected"},
    {code: "INVALID_ENUM", path: "select"},
  ],
  "choice-many-toppings-with-default": [
    {code: "UNKNOWN_KEY", path: "allowOther"},
    {code: "UNKNOWN_KEY", path: "maxSelected"},
    {code: "TOO_MANY", path: "options"},
    {code: "UNKNOWN_KEY", path: "otherLabel"},
    {code: "INVALID_ENUM", path: "select"},
  ],
  "choice-max-limits": [
    {code: "TOO_MANY", path: "options"},
    {code: "TOO_LONG", path: "options[0].label"},
  ],
  "choice-plan-with-default": [],
  "choice-two-options": [],
  "choice-two-options-no-decline": [],
  "confirm-allow-decline": [],
  "confirm-default-labels": [],
  "confirm-destructive-delete": [],
  "confirm-emoji-labels": [],
  "confirm-long-text-cut": [],
};

const compactErrors = (options: {id: string; label: string}[]) =>
  validateAskInput({
    input: {options, prompt: "Pick one.", select: "one"},
    kind: "choice",
    surface: "compact",
  });

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
        fix: 'Use one of "one", "many".',
        message: 'select must be one of "one", "many", not "all".',
        path: "select",
      },
    ]);
  });

  it("explains select many bounds that are not whole numbers or are out of range", () => {
    expect(
      validateAskInput({
        input: {
          maxSelected: 0,
          minSelected: 1.5,
          options: TWO_OPTIONS,
          prompt: "Pick.",
          select: "many",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "RANGE_INVALID",
        fix: "Make maxSelected at least 1.",
        message: "maxSelected must be at least 1.",
        path: "maxSelected",
      },
      {
        code: "INVALID_TYPE",
        fix: "Make minSelected a whole number.",
        message: "minSelected must be a whole number, not 1.5.",
        path: "minSelected",
      },
    ]);
  });

  it("names the choice count when maxSelected is more than the ask offers", () => {
    expect(
      validateAskInput({
        input: {maxSelected: 3, options: TWO_OPTIONS, prompt: "Pick.", select: "many"},
        kind: "choice",
      })
    ).toEqual([
      {
        code: "RANGE_INVALID",
        fix: "Set maxSelected to 2 or fewer, or add options.",
        message: "maxSelected is 3, but the ask offers 2 choices.",
        path: "maxSelected",
      },
    ]);
  });

  it("counts Other as a choice for maxSelected", () => {
    expect(
      validateAskInput({
        input: {
          allowOther: true,
          maxSelected: 3,
          options: TWO_OPTIONS,
          prompt: "Pick.",
          select: "many",
        },
        kind: "choice",
      })
    ).toEqual([]);
  });

  it("explains minSelected above maxSelected", () => {
    expect(
      validateAskInput({
        input: {
          maxSelected: 1,
          minSelected: 2,
          options: TWO_OPTIONS,
          prompt: "Pick.",
          select: "many",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "RANGE_INVALID",
        fix: "Lower minSelected, or raise maxSelected and add options.",
        message: "minSelected (2) is more than maxSelected (1).",
        path: "minSelected",
      },
    ]);
  });

  it("names the offered choices as the limit when minSelected and maxSelected are both above them", () => {
    expect(
      validateAskInput({
        input: {
          allowOther: true,
          maxSelected: 5,
          minSelected: 4,
          options: TWO_OPTIONS,
          prompt: "Pick.",
          select: "many",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "RANGE_INVALID",
        fix: "Set maxSelected to 3 or fewer, or add options.",
        message: "maxSelected is 5, but the ask offers 3 choices.",
        path: "maxSelected",
      },
      {
        code: "RANGE_INVALID",
        fix: "Lower minSelected, or raise maxSelected and add options.",
        message: "minSelected (4) is more than the 3 choices the ask offers.",
        path: "minSelected",
      },
    ]);
  });

  it("names the offered choices as the limit when minSelected is above them without maxSelected", () => {
    expect(
      validateAskInput({
        input: {minSelected: 3, options: TWO_OPTIONS, prompt: "Pick.", select: "many"},
        kind: "choice",
      })
    ).toEqual([
      {
        code: "RANGE_INVALID",
        fix: "Lower minSelected, or raise maxSelected and add options.",
        message: "minSelected (3) is more than the 2 choices the ask offers.",
        path: "minSelected",
      },
    ]);
  });

  it("points select one asks with many fields to select many", () => {
    expect(
      validateAskInput({
        input: {
          allowOther: true,
          minSelected: 2,
          options: TWO_OPTIONS,
          prompt: "Pick.",
          select: "one",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "OTHER_NOT_ALLOWED",
        fix: 'Use select "many" (with maxSelected 1 for a single pick), or remove allowOther.',
        message: 'allowOther needs select "many".',
        path: "allowOther",
      },
      {
        code: "RANGE_INVALID",
        fix: 'Remove minSelected, or use select "many".',
        message: 'select "one" picks exactly one option, so minSelected must be 1, not 2.',
        path: "minSelected",
      },
    ]);
  });

  it("explains too many or repeated defaults and otherLabel without allowOther", () => {
    expect(
      validateAskInput({
        input: {
          default: ["yes", "yes", "no"],
          maxSelected: 2,
          options: TWO_OPTIONS,
          otherLabel: "Something else",
          prompt: "Pick.",
          select: "many",
        },
        kind: "choice",
      })
    ).toEqual([
      {
        code: "SELECTION_COUNT",
        fix: "Keep at most 2 option ids in default.",
        message: "default lists 3 option ids, but the ask allows at most 2.",
        path: "default",
      },
      {
        code: "DUPLICATE_ID",
        fix: "List each option id in default once.",
        message: 'Default "yes" is already listed at default[0].',
        path: "default[1]",
      },
      {
        code: "OTHER_NOT_ALLOWED",
        fix: "Set allowOther to true, or remove otherLabel.",
        message: "otherLabel is set, but allowOther is not true.",
        path: "otherLabel",
      },
    ]);
  });

  it("rejects select many on the compact surface", () => {
    expect(
      validateAskInput({
        input: {options: TWO_OPTIONS, prompt: "Pick.", select: "many"},
        kind: "choice",
        surface: "compact",
      })
    ).toEqual([
      {
        code: "INVALID_ENUM",
        fix: 'Use "one".',
        message: 'select must be "one", not "many".',
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

  it("throws for a surface outside ASK_SURFACES", () => {
    expect(() =>
      validateAskInput({input: {}, kind: "choice", surface: "watch" as unknown as AskSurface})
    ).toThrow('Unknown ask surface "watch".');
  });
});

const compactKindFixtures = <Fixture extends {kind: AskKind}>(fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((fixture) => isCompactAskKind(fixture.kind));

describe("validateAskInput on the compact surface", () => {
  it("covers exactly the valid fixtures of the compact kinds", () => {
    expect(Object.keys(COMPACT_ERRORS_BY_FIXTURE).sort()).toEqual(
      compactKindFixtures(validAskFixtures())
        .map((fixture) => fixture.name)
        .sort()
    );
  });

  it("throws for a kind the compact surface does not offer", () => {
    expect(() =>
      validateAskInput({input: {prompt: "Edit it."}, kind: "markdown", surface: "compact"})
    ).toThrow('The compact surface does not offer ask kind "markdown".');
  });

  for (const fixture of compactKindFixtures(validAskFixtures())) {
    it(`returns the compact errors of valid/${fixture.name}`, () => {
      const errors = validateAskInput({
        input: fixture.input,
        kind: fixture.kind,
        surface: "compact",
      });
      expect(errors.map(({code, path}) => ({code, path}))).toEqual(
        COMPACT_ERRORS_BY_FIXTURE[fixture.name] ?? []
      );
    });
  }

  for (const fixture of compactKindFixtures(invalidAskFixtures())) {
    it(`still rejects invalid/${fixture.name}`, () => {
      expect(
        validateAskInput({input: fixture.input, kind: fixture.kind, surface: "compact"}).length
      ).toBeGreaterThan(0);
    });
  }

  it("accepts 2 or 3 options with distinct labels of at most 20 characters", () => {
    expect(compactErrors(TWO_OPTIONS)).toEqual([]);
    expect(
      compactErrors([
        {id: "starter", label: "Twenty characters!!!"},
        {id: "team", label: "Exactly twenty chars"},
        {id: "enterprise", label: "Party 🎉🎉🎉🎉🎉🎉🎉"},
      ])
    ).toEqual([]);
  });

  it("gives the limit of 3 options in TOO_MANY", () => {
    expect(
      compactErrors([...TWO_OPTIONS, {id: "maybe", label: "Maybe"}, {id: "later", label: "Later"}])
    ).toEqual([
      {
        code: "TOO_MANY",
        fix: "Remove items from options until it has 3 or fewer.",
        message: "options has more than 3 items.",
        path: "options",
      },
    ]);
  });

  it("gives the limit of 20 characters in TOO_LONG", () => {
    expect(compactErrors([{id: "yes", label: "x".repeat(21)}, NO_OPTION])).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten options[0].label to 20 characters or fewer.",
        message: "options[0].label is longer than 20 characters.",
        path: "options[0].label",
      },
    ]);
  });

  it("counts each emoji as 2 or more characters, as the button cut does", () => {
    expect(compactErrors([{id: "party", label: "Party 🎉🎉🎉🎉🎉🎉🎉🎉"}, NO_OPTION])).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten options[0].label to 20 characters or fewer, or use fewer emoji.",
        message: "options[0].label is longer than 20 characters, counting each emoji as 2 or more.",
        path: "options[0].label",
      },
    ]);
  });

  it("names the first option that used a duplicated label", () => {
    expect(
      compactErrors([
        {id: "red", label: "Red"},
        {id: "crimson", label: "Red"},
      ])
    ).toEqual([
      {
        code: "DUPLICATE_LABEL",
        fix: "Give every option a different label.",
        message: 'Option label "Red" is already used by options[0].',
        path: "options[1].label",
      },
    ]);
  });

  it("counts labels that differ only in spaces at either end as the same", () => {
    expect(
      compactErrors([
        {id: "go", label: "Go"},
        {id: "go_now", label: " Go "},
      ])
    ).toEqual([
      {
        code: "DUPLICATE_LABEL",
        fix: "Give every option a different label.",
        message:
          'Option label " Go " is already used by options[0], ignoring spaces at either end.',
        path: "options[1].label",
      },
    ]);
  });

  it("still rejects a label that is only spaces", () => {
    expect(
      compactErrors([{id: "go", label: "   "}, NO_OPTION]).map(({code, path}) => ({code, path}))
    ).toEqual([{code: "TOO_SHORT", path: "options[0].label"}]);
  });

  it("allows duplicated labels on the full surface", () => {
    expect(
      validateAskInput({
        input: {
          options: [
            {id: "red", label: "Red"},
            {id: "crimson", label: "Red"},
          ],
          prompt: "Pick one.",
          select: "one",
        },
        kind: "choice",
      })
    ).toEqual([]);
  });

  it("keeps the full rules: unique ids and a default among the options", () => {
    expect(
      validateAskInput({
        input: {
          default: ["green"],
          options: [
            {id: "red", label: "Red"},
            {id: "red", label: "Crimson"},
          ],
          prompt: "Pick one.",
          select: "one",
        },
        kind: "choice",
        surface: "compact",
      }).map(({code, path}) => ({code, path}))
    ).toEqual([
      {code: "DEFAULT_NOT_IN_OPTIONS", path: "default[0]"},
      {code: "DUPLICATE_ID", path: "options[1].id"},
    ]);
  });
});

describe("validateAskInput confirm", () => {
  it("accepts a prompt alone, taking the default labels", () => {
    expect(validateAskInput({input: {prompt: "Send it?"}, kind: "confirm"})).toEqual([]);
  });

  it("gives the 20-character limit of a button label in TOO_LONG", () => {
    expect(
      validateAskInput({input: {confirmLabel: "x".repeat(21), prompt: "Go?"}, kind: "confirm"})
    ).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten confirmLabel to 20 characters or fewer.",
        message: "confirmLabel is longer than 20 characters.",
        path: "confirmLabel",
      },
    ]);
  });

  it("counts each emoji as 2 or more characters, as the button cut does", () => {
    expect(
      validateAskInput({
        input: {denyLabel: "Wait 🕒🕒🕒🕒🕒🕒🕒🕒", prompt: "Go?"},
        kind: "confirm",
      })
    ).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten denyLabel to 20 characters or fewer, or use fewer emoji.",
        message: "denyLabel is longer than 20 characters, counting each emoji as 2 or more.",
        path: "denyLabel",
      },
    ]);
  });

  it("rejects two buttons with the same label, counting the default labels", () => {
    expect(
      validateAskInput({
        input: {confirmLabel: "Cancel", prompt: "Cancel the order?"},
        kind: "confirm",
      })
    ).toEqual([
      {
        code: "DUPLICATE_LABEL",
        fix: 'Give confirmLabel a label other than "Cancel", the deny button\'s label.',
        message: 'confirmLabel "Cancel" is the same as the deny button\'s label.',
        path: "confirmLabel",
      },
    ]);
    expect(
      validateAskInput({
        input: {confirmLabel: "OK", denyLabel: "OK", prompt: "Go?"},
        kind: "confirm",
      }).map(({code, path}) => ({code, path}))
    ).toEqual([{code: "DUPLICATE_LABEL", path: "denyLabel"}]);
  });

  it("counts labels that differ only in spaces at either end as the same", () => {
    expect(
      validateAskInput({
        input: {confirmLabel: "Send ", denyLabel: " Send", prompt: "Go?"},
        kind: "confirm",
      })
    ).toEqual([
      {
        code: "DUPLICATE_LABEL",
        fix: 'Give denyLabel a label other than "Send ", the approve button\'s label.',
        message:
          'denyLabel " Send" is the same as the approve button\'s label, ignoring spaces at either end.',
        path: "denyLabel",
      },
    ]);
    expect(
      validateAskInput({input: {confirmLabel: "Cancel ", prompt: "Go?"}, kind: "confirm"}).map(
        ({code, path}) => ({code, path})
      )
    ).toEqual([{code: "DUPLICATE_LABEL", path: "confirmLabel"}]);
    expect(
      validateAskInput({input: {denyLabel: "  ", prompt: "Go?"}, kind: "confirm"}).map(
        ({code, path}) => ({code, path})
      )
    ).toEqual([{code: "TOO_SHORT", path: "denyLabel"}]);
  });

  it("names confirmLabel and denyLabel in place of submitLabel", () => {
    expect(
      validateAskInput({input: {prompt: "Send it?", submitLabel: "Send"}, kind: "confirm"})
    ).toEqual([
      {
        code: "UNKNOWN_KEY",
        fix: 'Remove "submitLabel".',
        message: '"submitLabel" is not a field of this object.',
        path: "submitLabel",
      },
    ]);
  });

  it("applies the same rules on the compact surface", () => {
    for (const input of [
      {prompt: "Send it?"},
      {confirmLabel: "Delete 14 todos", denyLabel: "Keep them", destructive: true, prompt: "Go?"},
      {confirmLabel: "Cancel", prompt: "Go?"},
      {confirmLabel: "x".repeat(21), prompt: "Go?"},
    ]) {
      expect(validateAskInput({input, kind: "confirm", surface: "compact"})).toEqual(
        validateAskInput({input, kind: "confirm"})
      );
    }
  });
});

describe("validateAskInput form", () => {
  const form = (fields: unknown[]) => ({fields, prompt: "A few details."});

  it("accepts a form with a single field", () => {
    expect(
      validateAskInput({
        input: form([{id: "company", label: "Company", type: "text"}]),
        kind: "form",
      })
    ).toEqual([]);
  });

  it("names a field id that breaks the id format", () => {
    expect(
      validateAskInput({
        input: form([{id: "Full Name", label: "Name", type: "text"}]),
        kind: "form",
      })
    ).toEqual([
      {
        code: "INVALID_FORMAT",
        fix: 'Use 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit.',
        message: 'fields[0].id "Full Name" is not a valid field id.',
        path: "fields[0].id",
      },
    ]);
  });

  it("names the first field that used a duplicated id", () => {
    expect(
      validateAskInput({
        input: form([
          {id: "name", label: "Name", type: "text"},
          {id: "name", label: "Email", type: "email"},
        ]),
        kind: "form",
      })
    ).toEqual([
      {
        code: "DUPLICATE_ID",
        fix: "Give every field a unique id.",
        message: 'Field id "name" is already used by fields[0].',
        path: "fields[1].id",
      },
    ]);
  });

  it("lists the field types for an unknown type, so a password field is refused", () => {
    const [error] = validateAskInput({
      input: form([{id: "secret", label: "Password", type: "password"}]),
      kind: "form",
    });
    expect(error.code).toBe("INVALID_ENUM");
    expect(error.path).toBe("fields[0].type");
    expect(error.fix).toBe(
      'Use one of "text", "textarea", "email", "url", "phone", "number", "date", "time", "datetime", "boolean", "select", "multiselect".'
    );
  });

  it("checks a default with the same rules as an answer, naming the default", () => {
    expect(
      validateAskInput({
        input: form([
          {default: 0, id: "seats", label: "Seats", max: 500, min: 1, type: "number"},
          {
            default: "apac",
            id: "region",
            label: "Region",
            options: [
              {id: "us", label: "US"},
              {id: "eu", label: "EU"},
            ],
            type: "select",
          },
        ]),
        kind: "form",
      })
    ).toEqual([
      {
        code: "OUT_OF_RANGE",
        fix: "Make fields[0].default at least 1.",
        message: "fields[0].default is 0, below the field's min of 1.",
        path: "fields[0].default",
      },
      {
        code: "DEFAULT_NOT_IN_OPTIONS",
        fix: "Use an id from fields[1].options, or remove it from the default.",
        message: 'Default "apac" is not the id of any option of the field.',
        path: "fields[1].default",
      },
    ]);
  });

  it("runs the default rules only once the field's shape is valid", () => {
    expect(
      validateAskInput({
        input: form([{default: 0, id: "seats", label: "Seats", min: "1", type: "number"}]),
        kind: "form",
      }).map(({code, path}) => ({code, path}))
    ).toEqual([{code: "INVALID_TYPE", path: "fields[0].min"}]);
  });

  it("is not offered on the compact surface, because fields cannot be filled in there", () => {
    expect(() =>
      validateAskInput({
        input: form([{id: "name", label: "Name", type: "text"}]),
        kind: "form",
        surface: "compact",
      })
    ).toThrow('The compact surface does not offer ask kind "form".');
  });
});
