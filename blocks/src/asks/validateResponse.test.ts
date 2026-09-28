import {describe, expect, it} from "bun:test";
import type {ChoiceAskInput, ConfirmAskInput, FormAskInput, MarkdownAskInput} from "./schema";
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

const MANY_INPUT: ChoiceAskInput = {
  options: [
    {id: "cheese", label: "Cheese"},
    {id: "mushrooms", label: "Mushrooms"},
    {id: "olives", label: "Olives"},
    {id: "peppers", label: "Peppers"},
  ],
  prompt: "Which toppings?",
  select: "many",
};

const OTHER_INPUT: ChoiceAskInput = {
  ...MANY_INPUT,
  allowOther: true,
  maxSelected: 2,
  minSelected: 1,
};

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
    expect(codesAndPaths({action: "accept", content: {extra: "Gold", selected: ["team"]}})).toEqual(
      [{code: "UNKNOWN_KEY", path: "content.extra"}]
    );
  });

  it("OTHER_NOT_ALLOWED when the ask does not allow Other", () => {
    expect(check({action: "accept", content: {other: "Gold", selected: ["team"]}})).toEqual([
      {
        code: "OTHER_NOT_ALLOWED",
        fix: "Remove content.other and pick from the options.",
        message: "This ask does not accept an Other answer.",
        path: "content.other",
      },
    ]);
    expect(
      codesAndPaths({action: "accept", content: {other: "Gold", selected: ["cheese"]}}, MANY_INPUT)
    ).toEqual([{code: "OTHER_NOT_ALLOWED", path: "content.other"}]);
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

describe("validateAskResponse select many", () => {
  it("accepts any count from 1 to the option count by default", () => {
    expect(check({action: "accept", content: {selected: ["cheese"]}}, MANY_INPUT)).toEqual([]);
    expect(
      check(
        {action: "accept", content: {selected: ["cheese", "mushrooms", "olives", "peppers"]}},
        MANY_INPUT
      )
    ).toEqual([]);
  });

  it("SELECTION_COUNT gives the default bounds when nothing is selected", () => {
    expect(check({action: "accept", content: {selected: []}}, MANY_INPUT)).toEqual([
      {
        code: "SELECTION_COUNT",
        fix: "Send 1 to 4 options in content.selected.",
        message: "Choose 1 to 4 options; the answer selects 0.",
        path: "content.selected",
      },
    ]);
  });

  it("accepts an empty selection when minSelected is 0", () => {
    expect(
      check({action: "accept", content: {selected: []}}, {...MANY_INPUT, minSelected: 0})
    ).toEqual([]);
  });

  it("counts Other as one choice", () => {
    expect(check({action: "accept", content: {other: "Basil", selected: []}}, OTHER_INPUT)).toEqual(
      []
    );
    expect(
      check({action: "accept", content: {other: "Basil", selected: ["cheese"]}}, OTHER_INPUT)
    ).toEqual([]);
    expect(
      check(
        {action: "accept", content: {other: "Basil", selected: ["cheese", "olives"]}},
        OTHER_INPUT
      )
    ).toEqual([
      {
        code: "SELECTION_COUNT",
        fix: "Send 1 to 2 options in content.selected. Other counts as one choice.",
        message: "Choose 1 to 2 options; the answer selects 3, counting Other.",
        path: "content.selected",
      },
    ]);
  });

  it("names exactly N and at most N bounds", () => {
    const [exactly] = check(
      {action: "accept", content: {selected: ["cheese"]}},
      {...MANY_INPUT, maxSelected: 2, minSelected: 2}
    );
    expect(exactly?.message).toBe("Choose exactly 2 options; the answer selects 1.");
    const [atMost] = check(
      {action: "accept", content: {selected: ["cheese", "olives", "peppers"]}},
      {...MANY_INPUT, maxSelected: 2, minSelected: 0}
    );
    expect(atMost?.message).toBe("Choose at most 2 options; the answer selects 3.");
  });

  it("DUPLICATE_ID for an id selected twice", () => {
    expect(
      check({action: "accept", content: {selected: ["cheese", "cheese"]}}, MANY_INPUT)
    ).toEqual([
      {
        code: "DUPLICATE_ID",
        fix: "List each option id in content.selected once.",
        message: '"cheese" is already selected at content.selected[0].',
        path: "content.selected[1]",
      },
    ]);
  });

  it("OPTION_NOT_OFFERED for an id the ask did not offer", () => {
    expect(
      codesAndPaths({action: "accept", content: {selected: ["cheese", "ham"]}}, MANY_INPUT)
    ).toEqual([{code: "OPTION_NOT_OFFERED", path: "content.selected[1]"}]);
  });

  it("TOO_LONG and TOO_SHORT for the Other text", () => {
    expect(
      codesAndPaths(
        {action: "accept", content: {other: "o".repeat(501), selected: []}},
        OTHER_INPUT
      )
    ).toEqual([{code: "TOO_LONG", path: "content.other"}]);
    expect(
      codesAndPaths({action: "accept", content: {other: "  ", selected: ["cheese"]}}, OTHER_INPUT)
    ).toEqual([{code: "TOO_SHORT", path: "content.other"}]);
  });
});

describe("validateAskResponse confirm", () => {
  const DELETE_INPUT: ConfirmAskInput = {
    confirmLabel: "Delete 14 todos",
    denyLabel: "Keep them",
    destructive: true,
    prompt: "Delete 14 completed todos?",
  };

  const checkConfirm = (response: unknown, input: ConfirmAskInput = DELETE_INPUT) =>
    validateAskResponse({input, kind: "confirm", response});

  it("accepts confirmed true and confirmed false", () => {
    expect(checkConfirm({action: "accept", content: {confirmed: true}})).toEqual([]);
    expect(checkConfirm({action: "accept", content: {confirmed: false}})).toEqual([]);
  });

  it("refuses decline by default, because deny is the negative answer", () => {
    expect(checkConfirm({action: "decline"})).toEqual([
      {
        code: "DECLINE_NOT_ALLOWED",
        fix: 'Answer with action "accept".',
        message: "This ask cannot be skipped.",
        path: "action",
      },
    ]);
    expect(checkConfirm({action: "decline"}, {...DELETE_INPUT, allowDecline: false})).toHaveLength(
      1
    );
  });

  it("accepts decline when allowDecline is true, and cancel always", () => {
    expect(checkConfirm({action: "decline"}, {...DELETE_INPUT, allowDecline: true})).toEqual([]);
    expect(checkConfirm({action: "cancel", reason: "user_sent_message"})).toEqual([]);
  });

  it("MISSING_REQUIRED when confirmed is missing", () => {
    expect(checkConfirm({action: "accept", content: {}})).toEqual([
      {
        code: "MISSING_REQUIRED",
        fix: 'Add "confirmed" to content.',
        message: "content.confirmed is required.",
        path: "content.confirmed",
      },
    ]);
  });

  it("INVALID_TYPE when confirmed is not a boolean", () => {
    expect(checkConfirm({action: "accept", content: {confirmed: "yes"}})).toEqual([
      {
        code: "INVALID_TYPE",
        fix: "Make content.confirmed true or false.",
        message: "content.confirmed must be true or false, not a string.",
        path: "content.confirmed",
      },
    ]);
  });

  it("UNKNOWN_KEY for a choice answer sent to a confirm", () => {
    expect(
      checkConfirm({action: "accept", content: {confirmed: true, selected: ["yes"]}}).map(
        ({code, path}) => ({code, path})
      )
    ).toEqual([{code: "UNKNOWN_KEY", path: "content.selected"}]);
  });
});

describe("validateAskResponse markdown", () => {
  const DRAFT = "# We're live\n\nToday we launched.";
  const input: MarkdownAskInput = {
    initial: DRAFT,
    maxLength: 40,
    minLength: 10,
    prompt: "Edit the announcement, then send it back.",
  };
  const checkMarkdown = (
    response: unknown,
    markdownInput: MarkdownAskInput = input
  ): ReturnType<typeof validateAskResponse> =>
    validateAskResponse({input: markdownInput, kind: "markdown", response});
  const accept = (markdown: string, changed: boolean): unknown => ({
    action: "accept",
    content: {changed, markdown},
  });

  it("accepts the draft unchanged with changed false, and an edit with changed true", () => {
    expect(checkMarkdown(accept(DRAFT, false))).toEqual([]);
    expect(checkMarkdown(accept("# We're live\n\nWe launched today.", true))).toEqual([]);
  });

  it("accepts Skip, because allowDecline defaults to true", () => {
    expect(checkMarkdown({action: "decline"})).toEqual([]);
  });

  it("DECLINE_NOT_ALLOWED when allowDecline is false", () => {
    expect(
      checkMarkdown({action: "decline"}, {...input, allowDecline: false}).map(({code}) => code)
    ).toEqual(["DECLINE_NOT_ALLOWED"]);
  });

  it("TOO_LONG when the text is longer than maxLength", () => {
    expect(checkMarkdown(accept("x".repeat(41), true))).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten content.markdown to 40 characters or fewer.",
        message: "The text is 41 characters, but this ask allows at most 40.",
        path: "content.markdown",
      },
    ]);
  });

  it("counts maxLength in UTF-16 code units, so most emoji count as 2", () => {
    expect(checkMarkdown(accept("😀".repeat(20), true))).toEqual([]);
    expect(checkMarkdown(accept("😀".repeat(21), true)).map(({code}) => code)).toEqual([
      "TOO_LONG",
    ]);
  });

  it("TOO_LONG over the 20,000-character cap when the ask sets no maxLength", () => {
    const uncapped: MarkdownAskInput = {prompt: "Write it."};
    expect(checkMarkdown(accept("x".repeat(20_000), true), uncapped)).toEqual([]);
    expect(
      checkMarkdown(accept("x".repeat(20_001), true), uncapped).map(({code, path}) => ({
        code,
        path,
      }))
    ).toEqual([{code: "TOO_LONG", path: "content.markdown"}]);
    expect(
      checkMarkdown(accept("😀".repeat(10_001), true), uncapped).map(({code}) => code)
    ).toEqual(["TOO_LONG"]);
  });

  it("names the ask's maxLength, not the cap, when the text is also over the cap", () => {
    expect(checkMarkdown(accept("x".repeat(20_001), true))).toEqual([
      {
        code: "TOO_LONG",
        fix: "Shorten content.markdown to 40 characters or fewer.",
        message: "The text is 20001 characters, but this ask allows at most 40.",
        path: "content.markdown",
      },
    ]);
  });

  it("TOO_SHORT below minLength, not counting spaces at either end", () => {
    expect(checkMarkdown(accept("   short   ", true))).toEqual([
      {
        code: "TOO_SHORT",
        fix: "Write at least 10 characters in content.markdown.",
        message: "The text is 5 characters, but this ask needs at least 10.",
        path: "content.markdown",
      },
    ]);
    expect(checkMarkdown(accept("  ten chars!  ", true))).toEqual([]);
  });

  it("accepts an empty answer when the ask sets no minLength", () => {
    expect(checkMarkdown(accept("", false), {prompt: "Write it."})).toEqual([]);
    expect(checkMarkdown(accept("", true), {initial: "Draft", prompt: "Write it."})).toEqual([]);
  });

  it("CHANGED_MISMATCH when changed does not say whether the text differs from the draft", () => {
    expect(checkMarkdown(accept(DRAFT, true))).toEqual([
      {
        code: "CHANGED_MISMATCH",
        fix: "Set content.changed to false.",
        message: "The text is the same as the draft, but changed is true.",
        path: "content.changed",
      },
    ]);
    expect(checkMarkdown(accept(`${DRAFT}!`, false))).toEqual([
      {
        code: "CHANGED_MISMATCH",
        fix: "Set content.changed to true.",
        message: "The text differs from the draft, but changed is false.",
        path: "content.changed",
      },
    ]);
  });

  it("compares against an empty draft when the ask has no initial", () => {
    expect(checkMarkdown(accept("", true), {prompt: "Write it."}).map(({code}) => code)).toEqual([
      "CHANGED_MISMATCH",
    ]);
  });

  it("MISSING_REQUIRED and INVALID_TYPE for a malformed answer", () => {
    expect(
      checkMarkdown({action: "accept", content: {markdown: 7}}).map(({code, path}) => ({
        code,
        path,
      }))
    ).toEqual([
      {code: "MISSING_REQUIRED", path: "content.changed"},
      {code: "INVALID_TYPE", path: "content.markdown"},
    ]);
  });

  it("UNKNOWN_KEY for a confirm answer sent to a markdown ask", () => {
    expect(
      checkMarkdown({
        action: "accept",
        content: {changed: false, confirmed: true, markdown: DRAFT},
      }).map(({code, path}) => ({code, path}))
    ).toEqual([{code: "UNKNOWN_KEY", path: "content.confirmed"}]);
  });
});

describe("validateAskResponse form", () => {
  const OPTIONS = [
    {id: "us", label: "US"},
    {id: "eu", label: "EU"},
  ];
  const input: FormAskInput = {
    fields: [
      {id: "company", label: "Company name", maxLength: 120, required: true, type: "text"},
      {id: "seats", integer: true, label: "Seats", max: 500, min: 1, type: "number"},
      {id: "start", label: "Start date", type: "date"},
      {id: "region", label: "Region", options: OPTIONS, type: "select"},
      {default: true, id: "notify", label: "Email me the invoice", type: "boolean"},
    ],
    prompt: "A few details for the invoice.",
  };
  const everyType: FormAskInput = {
    fields: [
      {id: "notes", label: "Notes", maxLength: 20, minLength: 5, type: "textarea"},
      {id: "email", label: "Email", type: "email"},
      {id: "site", label: "Site", type: "url"},
      {id: "phone", label: "Phone", type: "phone"},
      {id: "at", label: "At", type: "time"},
      {id: "starts", label: "Starts", type: "datetime"},
      {id: "regions", label: "Regions", options: OPTIONS, required: true, type: "multiselect"},
    ],
    prompt: "Every other type.",
  };
  const checkForm = (values: unknown, formInput: FormAskInput = input) =>
    validateAskResponse({
      input: formInput,
      kind: "form",
      response: {action: "accept", content: {values}},
    });
  const codesAndPaths = (values: unknown, formInput: FormAskInput = input) =>
    checkForm(values, formInput).map(({code, path}) => ({code, path}));

  it("accepts the answer from the plan's example", () => {
    expect(
      checkForm({company: "Acme", notify: true, region: "us", seats: 12, start: "2026-10-01"})
    ).toEqual([]);
  });

  it("accepts an answer that leaves optional fields out", () => {
    expect(checkForm({company: "Acme"})).toEqual([]);
  });

  it("counts a blank value on an optional field as unanswered", () => {
    expect(checkForm({company: "Acme", start: "  "})).toEqual([]);
    expect(checkForm({notes: "", regions: ["us"]}, everyType)).toEqual([]);
  });

  it("accepts a valid value for every other type", () => {
    expect(
      checkForm(
        {
          at: "09:30",
          email: "ada@example.com",
          notes: "Gate 12",
          phone: "+14155552671",
          regions: ["eu", "us"],
          site: "https://example.com/about",
          starts: "2026-10-01T09:30:00-07:00",
        },
        everyType
      )
    ).toEqual([]);
  });

  it("accepts a datetime with or without seconds", () => {
    for (const starts of [
      "2026-10-01T09:30Z",
      "2026-10-01T09:30+02:00",
      "2026-10-01T09:30:15Z",
      "2026-10-01T09:30:15.250-07:00",
    ]) {
      expect(checkForm({regions: ["us"], starts}, everyType)).toEqual([]);
    }
    expect(codesAndPaths({regions: ["us"], starts: "2026-10-01T09:30"}, everyType)).toEqual([
      {code: "INVALID_DATE", path: "content.values.starts"},
    ]);
  });

  it("REQUIRED_FIELD when a required field is missing, blank, or an empty list", () => {
    expect(checkForm({})).toEqual([
      {
        code: "REQUIRED_FIELD",
        fix: 'Fill in "Company name" (content.values.company).',
        message: '"Company name" is required.',
        path: "content.values.company",
      },
    ]);
    expect(codesAndPaths({company: "   "})).toEqual([
      {code: "REQUIRED_FIELD", path: "content.values.company"},
    ]);
    expect(codesAndPaths({regions: []}, everyType)).toEqual([
      {code: "REQUIRED_FIELD", path: "content.values.regions"},
    ]);
  });

  it("FIELD_TYPE_MISMATCH for the wrong JSON type, a fraction in an integer field, or null", () => {
    expect(checkForm({company: "Acme", seats: "12"})).toEqual([
      {
        code: "FIELD_TYPE_MISMATCH",
        fix: "Make content.values.seats a number.",
        message: 'content.values.seats must be a number for the number field "seats".',
        path: "content.values.seats",
      },
    ]);
    expect(checkForm({company: "Acme", seats: 1.5})).toEqual([
      {
        code: "FIELD_TYPE_MISMATCH",
        fix: "Make content.values.seats a whole number.",
        message: "content.values.seats is 1.5, but the field takes whole numbers only.",
        path: "content.values.seats",
      },
    ]);
    expect(codesAndPaths({company: 7, notify: "yes", region: ["us"], start: null})).toEqual([
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.company"},
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.notify"},
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.region"},
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.start"},
    ]);
  });

  it("FIELD_TYPE_MISMATCH for an invalid email, URL, or phone number", () => {
    expect(
      codesAndPaths(
        {email: "ada@", phone: "call me", regions: ["us"], site: "ftp://example.com"},
        everyType
      )
    ).toEqual([
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.email"},
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.phone"},
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.site"},
    ]);
    expect(codesAndPaths({phone: "+1 234", regions: ["us"]}, everyType)).toEqual([
      {code: "FIELD_TYPE_MISMATCH", path: "content.values.phone"},
    ]);
    expect(checkForm({phone: "(415) 555-2671", regions: ["us"]}, everyType)).toEqual([]);
  });

  it("OUT_OF_RANGE below min or above max", () => {
    expect(checkForm({company: "Acme", seats: 0})).toEqual([
      {
        code: "OUT_OF_RANGE",
        fix: "Make content.values.seats at least 1.",
        message: "content.values.seats is 0, below the field's min of 1.",
        path: "content.values.seats",
      },
    ]);
    expect(codesAndPaths({company: "Acme", seats: 501})).toEqual([
      {code: "OUT_OF_RANGE", path: "content.values.seats"},
    ]);
    expect(checkForm({company: "Acme", seats: 500})).toEqual([]);
  });

  it("INVALID_DATE for a date that is not real or not in the field's format", () => {
    expect(checkForm({company: "Acme", start: "2026-02-30"})).toEqual([
      {
        code: "INVALID_DATE",
        fix: 'Write content.values.start as YYYY-MM-DD, such as "2026-10-01".',
        message: 'content.values.start "2026-02-30" is not a real date in YYYY-MM-DD.',
        path: "content.values.start",
      },
    ]);
    expect(
      codesAndPaths({at: "9:30 PM", regions: ["us"], starts: "2026-10-01T09:30:00"}, everyType)
    ).toEqual([
      {code: "INVALID_DATE", path: "content.values.at"},
      {code: "INVALID_DATE", path: "content.values.starts"},
    ]);
    expect(codesAndPaths({company: "Acme", start: "2026-10-01T00:00:00Z"})).toEqual([
      {code: "INVALID_DATE", path: "content.values.start"},
    ]);
  });

  it("TOO_LONG and TOO_SHORT against the field's length bounds", () => {
    expect(codesAndPaths({company: "x".repeat(121)})).toEqual([
      {code: "TOO_LONG", path: "content.values.company"},
    ]);
    expect(checkForm({notes: "  abc  ", regions: ["us"]}, everyType)).toEqual([
      {
        code: "TOO_SHORT",
        fix: "Write at least 5 characters in content.values.notes.",
        message: "content.values.notes is 3 characters, but the field needs at least 5.",
        path: "content.values.notes",
      },
    ]);
  });

  it("caps a text field without maxLength at 2,000 characters and a textarea at 10,000", () => {
    const uncapped: FormAskInput = {
      fields: [
        {id: "title", label: "Title", type: "text"},
        {id: "body", label: "Body", type: "textarea"},
      ],
      prompt: "Write it.",
    };
    expect(checkForm({body: "x".repeat(10_000), title: "x".repeat(2000)}, uncapped)).toEqual([]);
    expect(codesAndPaths({body: "x".repeat(10_001), title: "x".repeat(2001)}, uncapped)).toEqual([
      {code: "TOO_LONG", path: "content.values.body"},
      {code: "TOO_LONG", path: "content.values.title"},
    ]);
  });

  it("OPTION_NOT_OFFERED and DUPLICATE_ID for select and multiselect values", () => {
    expect(codesAndPaths({company: "Acme", region: "apac"})).toEqual([
      {code: "OPTION_NOT_OFFERED", path: "content.values.region"},
    ]);
    expect(codesAndPaths({regions: ["us", "apac", "us"]}, everyType)).toEqual([
      {code: "OPTION_NOT_OFFERED", path: "content.values.regions[1]"},
      {code: "DUPLICATE_ID", path: "content.values.regions[2]"},
    ]);
  });

  it("UNKNOWN_KEY for a value that belongs to no field", () => {
    expect(checkForm({company: "Acme", password: "hunter2"})).toEqual([
      {
        code: "UNKNOWN_KEY",
        fix: 'Remove "password" from content.values.',
        message: '"password" is not the id of any field in this form.',
        path: "content.values.password",
      },
    ]);
  });

  it("MISSING_REQUIRED and UNKNOWN_KEY for a malformed content object", () => {
    expect(
      validateAskResponse({
        input,
        kind: "form",
        response: {action: "accept", content: {company: "Acme"}},
      }).map(({code, path}) => ({code, path}))
    ).toEqual([
      {code: "UNKNOWN_KEY", path: "content.company"},
      {code: "MISSING_REQUIRED", path: "content.values"},
    ]);
  });

  it("accepts Skip unless allowDecline is false", () => {
    expect(validateAskResponse({input, kind: "form", response: {action: "decline"}})).toEqual([]);
    expect(
      validateAskResponse({
        input: {...input, allowDecline: false},
        kind: "form",
        response: {action: "decline"},
      }).map(({code}) => code)
    ).toEqual(["DECLINE_NOT_ALLOWED"]);
  });
});
