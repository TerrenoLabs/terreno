import {describe, expect, it} from "bun:test";
import {type ValidAskFixture, validAskFixtures, validAskFixturesOf} from "../tests/askFixtures";
import {ASK_LIMITS} from "./limits";
import type {ChoiceAskInput, ConfirmAskInput, MarkdownAskInput} from "./schema";
import {resolveButtonAnswer, simpleCardSchema, toSimpleCard} from "./simpleCard";
import {validateAskInput} from "./validateInput";
import {validateAskResponse} from "./validateResponse";

const TOOL_CALL_ID = "call_fixture";

/**
 * Rows of the `choice` rule table in docs/reference/agent-ui-asks.md. The `many` row splits on
 * whether the default is a valid answer on its own, which is when the card offers Use suggested.
 */
type ChoiceRow =
  | "optionsFit"
  | "moreOptions"
  | "labelsCollide"
  | "manyWithSuggestion"
  | "manyWithoutSuggestion";

/** The row each valid `choice` fixture exercises, read off the rule table by hand. */
const CHOICE_ROW_BY_FIXTURE: Record<string, ChoiceRow> = {
  "choice-emoji-label-cut": "optionsFit",
  "choice-labels-collide-after-cut": "labelsCollide",
  "choice-long-text-cut": "optionsFit",
  "choice-many-default-below-min": "manyWithoutSuggestion",
  "choice-many-every-choice-with-other": "manyWithoutSuggestion",
  "choice-many-no-default": "manyWithoutSuggestion",
  "choice-many-optional-no-buttons": "manyWithoutSuggestion",
  "choice-many-options-default-label-collides": "labelsCollide",
  "choice-many-options-no-buttons": "moreOptions",
  "choice-many-options-no-default": "moreOptions",
  "choice-many-options-with-default": "moreOptions",
  "choice-many-required-with-default": "manyWithSuggestion",
  "choice-many-single-pick-or-other": "manyWithSuggestion",
  "choice-many-toppings-with-default": "manyWithSuggestion",
  "choice-max-limits": "moreOptions",
  "choice-plan-with-default": "optionsFit",
  "choice-two-options": "optionsFit",
  "choice-two-options-no-decline": "optionsFit",
};

const MANY_ROWS: readonly ChoiceRow[] = ["manyWithSuggestion", "manyWithoutSuggestion"];

interface ExpectedButton {
  id: string;
  response: unknown;
  style: string;
}

const SKIP: ExpectedButton = {id: "skip", response: {action: "decline"}, style: "cancel"};

const selects = (...ids: string[]): unknown => ({action: "accept", content: {selected: ids}});

/** The buttons a row allows for an input, without their labels, written from the rule table. */
const buttonsForRow = (input: ChoiceAskInput, row: ChoiceRow): ExpectedButton[] => {
  const skip = input.allowDecline === false ? [] : [SKIP];
  const defaultId = input.default?.[0];
  if (row === "labelsCollide" || row === "manyWithoutSuggestion") {
    return skip;
  }
  if (row === "manyWithSuggestion") {
    return [
      {id: "use-default", response: selects(...(input.default ?? [])), style: "primary"},
      ...skip,
    ];
  }
  if (row === "moreOptions") {
    const useDefault = defaultId
      ? [{id: "use-default", response: selects(defaultId), style: "primary"}]
      : [];
    return [...useDefault, ...skip];
  }
  const others = input.options.map((option) => option.id).filter((id) => id !== defaultId);
  const options = [
    ...(defaultId
      ? [{id: `option:${defaultId}`, response: selects(defaultId), style: "primary"}]
      : []),
    ...others.map((id) => ({id: `option:${id}`, response: selects(id), style: "default"})),
  ];
  return options.length < 3 ? [...options, ...skip] : options;
};

/** The `confirm` row: approve (destructive when the ask is) first, deny last, and never Skip. */
const confirmButtons = (input: ConfirmAskInput): ExpectedButton[] => [
  {
    id: "approve",
    response: {action: "accept", content: {confirmed: true}},
    style: input.destructive === true ? "destructive" : "primary",
  },
  {id: "deny", response: {action: "accept", content: {confirmed: false}}, style: "cancel"},
];

/** Whether each valid `markdown` fixture's `initial` meets its length rules, read off by hand. */
const MARKDOWN_DRAFT_FITS_BY_FIXTURE: Record<string, boolean> = {
  "markdown-announcement-draft": true,
  "markdown-empty-draft": true,
  "markdown-initial-blank-below-min": false,
  "markdown-initial-over-max": false,
  "markdown-long-text-cut": true,
  "markdown-no-decline": true,
  "markdown-no-initial-with-min": false,
};

/** The `markdown` row: Approve draft when the draft fits, then Cancel when the ask allows it. */
const markdownButtons = (input: MarkdownAskInput, isDraftFitting: boolean): ExpectedButton[] => [
  ...(isDraftFitting
    ? [
        {
          id: "approve",
          response: {action: "accept", content: {changed: false, markdown: input.initial ?? ""}},
          style: "primary",
        },
      ]
    : []),
  ...(input.allowDecline === false
    ? []
    : [{id: "cancel", response: {action: "decline"}, style: "cancel"}]),
];

/** The buttons and handoff the rule table gives a valid fixture. */
const expectedCard = (fixture: ValidAskFixture): {buttons: ExpectedButton[]; handoff: boolean} => {
  if (fixture.kind === "confirm") {
    return {buttons: confirmButtons(fixture.input), handoff: false};
  }
  if (fixture.kind === "markdown") {
    const isDraftFitting = MARKDOWN_DRAFT_FITS_BY_FIXTURE[fixture.name];
    if (isDraftFitting === undefined) {
      throw new Error(`Add valid/${fixture.name} to MARKDOWN_DRAFT_FITS_BY_FIXTURE.`);
    }
    return {buttons: markdownButtons(fixture.input, isDraftFitting), handoff: true};
  }
  const row = CHOICE_ROW_BY_FIXTURE[fixture.name];
  if (!row) {
    throw new Error(`Add valid/${fixture.name} to CHOICE_ROW_BY_FIXTURE.`);
  }
  return {buttons: buttonsForRow(fixture.input, row), handoff: row !== "optionsFit"};
};

describe("toSimpleCard golden fixtures", () => {
  for (const fixture of validAskFixtures()) {
    it(`derives the expected card for valid/${fixture.name}`, () => {
      expect(
        toSimpleCard({input: fixture.input, kind: fixture.kind, toolCallId: TOOL_CALL_ID})
      ).toEqual(fixture.simple);
    });
  }
});

describe("toSimpleCard properties over every valid fixture", () => {
  for (const fixture of validAskFixtures()) {
    describe(`valid/${fixture.name}`, () => {
      const card = toSimpleCard({
        input: fixture.input,
        kind: fixture.kind,
        toolCallId: TOOL_CALL_ID,
      });

      it("passes simpleCardSchema", () => {
        expect(simpleCardSchema.safeParse(card).success).toBe(true);
      });

      it("keeps the kind and toolCallId", () => {
        expect(card.kind).toBe(fixture.kind);
        expect(card.toolCallId).toBe(TOOL_CALL_ID);
      });

      it("only has buttons whose response is a valid answer to the ask", () => {
        for (const button of card.buttons) {
          expect(
            validateAskResponse({
              input: fixture.input,
              kind: fixture.kind,
              response: button.response,
            })
          ).toEqual([]);
        }
      });

      it("has the buttons and handoff of its rule-table row", () => {
        const expected = expectedCard(fixture);
        expect(card.handoff).toBe(expected.handoff);
        expect(card.buttons.map(({id, response, style}) => ({id, response, style}))).toEqual(
          expected.buttons
        );
      });

      it("never shows two buttons with the same label", () => {
        const labels = card.buttons.map((button) => button.label);
        expect(new Set(labels).size).toBe(labels.length);
      });

      it("puts Skip last", () => {
        const skipIndex = card.buttons.findIndex((button) => button.id === "skip");
        if (skipIndex >= 0) {
          expect(skipIndex).toBe(card.buttons.length - 1);
        }
      });
    });
  }
});

describe("the rule-table row map", () => {
  it("lists exactly the valid markdown fixtures", () => {
    expect(Object.keys(MARKDOWN_DRAFT_FITS_BY_FIXTURE).sort()).toEqual(
      validAskFixturesOf("markdown")
        .map((fixture) => fixture.name)
        .sort()
    );
  });

  it("lists exactly the valid choice fixtures", () => {
    expect(Object.keys(CHOICE_ROW_BY_FIXTURE).sort()).toEqual(
      validAskFixturesOf("choice")
        .map((fixture) => fixture.name)
        .sort()
    );
  });

  it("uses optionsFit only for at most 3 options and moreOptions only for more", () => {
    for (const fixture of validAskFixturesOf("choice")) {
      const row = CHOICE_ROW_BY_FIXTURE[fixture.name];
      if (row === "optionsFit") {
        expect(fixture.input.options.length).toBeLessThanOrEqual(3);
      }
      if (row === "moreOptions") {
        expect(fixture.input.options.length).toBeGreaterThan(3);
      }
    }
  });

  it("uses the many rows exactly for select many", () => {
    for (const fixture of validAskFixturesOf("choice")) {
      const row = CHOICE_ROW_BY_FIXTURE[fixture.name] ?? "optionsFit";
      expect(MANY_ROWS.includes(row)).toBe(fixture.input.select === "many");
    }
  });
});

describe("toSimpleCard choice many rules", () => {
  const TOPPINGS = [
    {id: "cheese", label: "Cheese"},
    {id: "olives", label: "Olives"},
    {id: "peppers", label: "Peppers"},
  ];

  it("offers Use suggested for a default within the bounds, then Skip", () => {
    expect(
      toSimpleCard({
        input: {
          default: ["olives", "cheese"],
          options: TOPPINGS,
          prompt: "Toppings?",
          select: "many",
        },
        kind: "choice",
        toolCallId: "call_1",
      })
    ).toEqual({
      buttons: [
        {
          id: "use-default",
          label: "Use suggested",
          response: {action: "accept", content: {selected: ["olives", "cheese"]}},
          style: "primary",
        },
        {id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"},
      ],
      handoff: true,
      kind: "choice",
      text: "Toppings?",
      toolCallId: "call_1",
    });
  });

  it("hands off even when every option would fit a button, because a tap picks only one", () => {
    const card = toSimpleCard({
      input: {options: TOPPINGS.slice(0, 2), prompt: "Toppings?", select: "many"},
      kind: "choice",
      toolCallId: "call_1",
    });
    expect(card.handoff).toBe(true);
    expect(card.buttons.map((button) => button.id)).toEqual(["skip"]);
  });

  it("leaves out Use suggested when the default has fewer choices than minSelected", () => {
    const card = toSimpleCard({
      input: {
        default: ["cheese"],
        minSelected: 2,
        options: TOPPINGS,
        prompt: "Toppings?",
        select: "many",
      },
      kind: "choice",
      toolCallId: "call_1",
    });
    expect(card.buttons.map((button) => button.id)).toEqual(["skip"]);
  });

  it("leaves out Use suggested for an empty default, even when no choice is required", () => {
    const card = toSimpleCard({
      input: {default: [], minSelected: 0, options: TOPPINGS, prompt: "Toppings?", select: "many"},
      kind: "choice",
      toolCallId: "call_1",
    });
    expect(card.buttons.map((button) => button.id)).toEqual(["skip"]);
  });
});

const COMPACT_LABEL_SETS = [
  ["Yes", "No"],
  ["Twenty characters!!!", "Exactly twenty chars"],
  ["Party 🎉🎉🎉🎉🎉🎉🎉", "Quiet night 🌙"],
  ["Starter", "Team", "Enterprise"],
  ["A", "B", "C"],
];

const LONG_PROMPT = Array.from({length: 100}, () => "word").join(" ");

/** Every combination of labels, default, allowDecline, title, and prompt length. */
const generatedCompactAsks = (): ChoiceAskInput[] =>
  COMPACT_LABEL_SETS.flatMap((labels) => {
    const options = labels.map((label, index) => ({id: `option-${index}`, label}));
    const defaults = [undefined, ...options.map((option) => [option.id])];
    return defaults.flatMap((defaultIds) =>
      [undefined, true, false].flatMap((allowDecline) =>
        [undefined, "t".repeat(80)].flatMap((title) =>
          ["Pick one.", LONG_PROMPT].map(
            (prompt): ChoiceAskInput => ({
              options,
              prompt,
              select: "one",
              ...(allowDecline === undefined ? {} : {allowDecline}),
              ...(defaultIds === undefined ? {} : {default: defaultIds}),
              ...(title === undefined ? {} : {title}),
            })
          )
        )
      )
    );
  });

const compactFixtureAsks = (): ChoiceAskInput[] =>
  validAskFixturesOf("choice")
    .filter(
      (fixture) =>
        validateAskInput({input: fixture.input, kind: fixture.kind, surface: "compact"}).length ===
        0
    )
    .map((fixture) => fixture.input);

describe("toSimpleCard properties over compact asks", () => {
  const asks = [...generatedCompactAsks(), ...compactFixtureAsks()];
  const cards = asks.map((input) => ({
    card: toSimpleCard({input, kind: "choice", toolCallId: TOOL_CALL_ID}),
    input,
  }));

  it("covers generated asks and the compact fixtures", () => {
    expect(generatedCompactAsks().length).toBeGreaterThan(100);
    expect(compactFixtureAsks().length).toBe(3);
  });

  it("only generates asks that pass the compact rules", () => {
    for (const input of asks) {
      expect(validateAskInput({input, kind: "choice", surface: "compact"})).toEqual([]);
    }
  });

  it("derives cards that pass simpleCardSchema", () => {
    for (const {card} of cards) {
      expect(simpleCardSchema.safeParse(card).success).toBe(true);
    }
  });

  it("never hands off", () => {
    for (const {card} of cards) {
      expect(card.handoff).toBe(false);
    }
  });

  it("follows the optionsFit row of the rule table", () => {
    for (const {card, input} of cards) {
      expect(card.buttons.map(({id, response, style}) => ({id, response, style}))).toEqual(
        buttonsForRow(input, "optionsFit")
      );
    }
  });

  it("shows every option's label uncut", () => {
    for (const {card, input} of cards) {
      for (const option of input.options) {
        expect(card.buttons.find((button) => button.id === `option:${option.id}`)?.label).toBe(
          option.label
        );
      }
    }
  });

  it("only has buttons whose response is a valid answer to the ask", () => {
    for (const {card, input} of cards) {
      for (const button of card.buttons) {
        expect(validateAskResponse({input, kind: "choice", response: button.response})).toEqual([]);
      }
    }
  });
});

describe("resolveButtonAnswer", () => {
  const plan = validAskFixturesOf("choice").find(
    (fixture) => fixture.name === "choice-plan-with-default"
  );
  if (!plan) {
    throw new Error("valid/choice-plan-with-default is missing.");
  }
  const card = toSimpleCard({input: plan.input, kind: plan.kind, toolCallId: TOOL_CALL_ID});

  it("returns the response stored on each button", () => {
    for (const button of card.buttons) {
      expect(resolveButtonAnswer({buttonId: button.id, card})).toEqual({
        errors: [],
        response: button.response,
      });
    }
  });

  it("returns UNKNOWN_BUTTON with the card's button ids for any other id", () => {
    expect(resolveButtonAnswer({buttonId: "option:gold", card})).toEqual({
      errors: [
        {
          code: "UNKNOWN_BUTTON",
          fix: 'Send the id of one of the card\'s buttons: "option:team", "option:starter", "option:enterprise".',
          message: 'Button "option:gold" is not on the pending ask\'s simple card.',
          path: "buttonId",
        },
      ],
    });
  });

  it("points to a full answer when the card has no buttons", () => {
    expect(resolveButtonAnswer({buttonId: "skip", card: {...card, buttons: []}}).errors).toEqual([
      {
        code: "UNKNOWN_BUTTON",
        fix: "The card has no buttons. Send a full askResponse instead.",
        message: 'Button "skip" is not on the pending ask\'s simple card.',
        path: "buttonId",
      },
    ]);
  });
});

describe("toSimpleCard choice rules", () => {
  const WEEKLY_OPTIONS = [
    {id: "managers", label: "Weekly summary email for managers"},
    {id: "engineers", label: "Weekly summary email for engineers"},
  ];

  it("shows no buttons when labels collide and the ask cannot be declined", () => {
    expect(
      toSimpleCard({
        input: {allowDecline: false, options: WEEKLY_OPTIONS, prompt: "Pick one.", select: "one"},
        kind: "choice",
        toolCallId: "call_1",
      })
    ).toEqual({
      buttons: [],
      handoff: true,
      kind: "choice",
      text: "Pick one.",
      toolCallId: "call_1",
    });
  });

  it("shows only Skip when two other options collide, even though the default's label is unique", () => {
    expect(
      toSimpleCard({
        input: {
          default: ["team"],
          options: [{id: "team", label: "Team"}, ...WEEKLY_OPTIONS],
          prompt: "Pick one.",
          select: "one",
        },
        kind: "choice",
        toolCallId: "call_1",
      })
    ).toEqual({
      buttons: [{id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"}],
      handoff: true,
      kind: "choice",
      text: "Pick one.",
      toolCallId: "call_1",
    });
  });

  it("moves a default listed last to the front, keeps the rest in order, and ends with Skip", () => {
    expect(
      toSimpleCard({
        input: {
          default: ["archive"],
          options: [
            {id: "keep", label: "Keep them"},
            {id: "archive", label: "Archive them"},
          ],
          prompt: "Pick one.",
          select: "one",
        },
        kind: "choice",
        toolCallId: "call_1",
      }).buttons
    ).toEqual([
      {
        id: "option:archive",
        label: "Archive them",
        response: {action: "accept", content: {selected: ["archive"]}},
        style: "primary",
      },
      {
        id: "option:keep",
        label: "Keep them",
        response: {action: "accept", content: {selected: ["keep"]}},
        style: "default",
      },
      {id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"},
    ]);
  });

  it("shows labels without spaces at either end, and hands off when that makes two alike", () => {
    const card = (options: {id: string; label: string}[]) =>
      toSimpleCard({
        input: {options, prompt: "Pick one.", select: "one"},
        kind: "choice",
        toolCallId: "call_1",
      });
    expect(
      card([
        {id: "go", label: " Go "},
        {id: "wait", label: "Wait"},
      ]).buttons.map((button) => button.label)
    ).toEqual(["Go", "Wait", "Skip"]);
    expect(
      card([
        {id: "go", label: "Go"},
        {id: "go_now", label: "Go "},
      ])
    ).toEqual({
      buttons: [{id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"}],
      handoff: true,
      kind: "choice",
      text: "Pick one.",
      toolCallId: "call_1",
    });
  });
});

describe("simpleCardSchema", () => {
  const skip = {id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"};
  const card = {
    buttons: [skip],
    handoff: true,
    kind: "choice",
    text: "Pick one.",
    toolCallId: "call_1",
  };

  it("accepts a minimal card", () => {
    expect(simpleCardSchema.safeParse(card).success).toBe(true);
  });

  it("rejects more than three buttons", () => {
    const buttons = ["a", "b", "c", "d"].map((id) => ({...skip, id}));
    expect(simpleCardSchema.safeParse({...card, buttons}).success).toBe(false);
  });

  it("rejects duplicate button ids", () => {
    const result = simpleCardSchema.safeParse({...card, buttons: [skip, skip]});
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["buttons", 1, "id"]]);
  });

  it("rejects labels over 20 characters, text over 140, and titles over 40", () => {
    expect(
      simpleCardSchema.safeParse({...card, buttons: [{...skip, label: "x".repeat(21)}]}).success
    ).toBe(false);
    expect(simpleCardSchema.safeParse({...card, text: "x".repeat(141)}).success).toBe(false);
    expect(simpleCardSchema.safeParse({...card, title: "x".repeat(41)}).success).toBe(false);
  });

  it("rejects a button whose response is not an answer envelope", () => {
    expect(
      simpleCardSchema.safeParse({...card, buttons: [{...skip, response: {action: "skip"}}]})
        .success
    ).toBe(false);
  });
});

describe("toSimpleCard text cuts", () => {
  const ask = (label: string) =>
    toSimpleCard({
      input: {
        options: [
          {id: "a", label},
          {id: "b", label: "Other"},
        ],
        prompt: "Pick one.",
        select: "one",
      },
      kind: "choice",
      toolCallId: "call_1",
    });

  it("keeps a label of exactly 20 characters", () => {
    expect(ask("Twenty characters!!!").buttons[0]?.label).toBe("Twenty characters!!!");
  });

  it("cuts at the space when the cut lands right before one", () => {
    expect(ask("Nineteen characters and more").buttons[0]?.label).toBe("Nineteen characters…");
  });

  it("cuts a single long word without looking for a boundary", () => {
    expect(ask("Supercalifragilisticexpialidocious").buttons[0]?.label).toBe(
      "Supercalifragilisti…"
    );
  });
});

const CONFIRM_LABEL_SETS: {confirmLabel?: string; denyLabel?: string}[] = [
  {},
  {confirmLabel: "Delete 14 todos", denyLabel: "Keep them"},
  {confirmLabel: "Twenty characters!!!", denyLabel: "Exactly twenty chars"},
  {confirmLabel: "Ship it 🚀", denyLabel: "Wait ⏳"},
  {confirmLabel: "Send"},
  {denyLabel: "Not now"},
];

/** Every combination of labels, destructive, allowDecline, title, and prompt length. */
const generatedConfirmAsks = (): ConfirmAskInput[] =>
  CONFIRM_LABEL_SETS.flatMap((labels) =>
    [undefined, true, false].flatMap((destructive) =>
      [undefined, true, false].flatMap((allowDecline) =>
        [undefined, "t".repeat(80)].flatMap((title) =>
          ["Go ahead?", LONG_PROMPT].map(
            (prompt): ConfirmAskInput => ({
              prompt,
              ...labels,
              ...(allowDecline === undefined ? {} : {allowDecline}),
              ...(destructive === undefined ? {} : {destructive}),
              ...(title === undefined ? {} : {title}),
            })
          )
        )
      )
    )
  );

describe("toSimpleCard confirm rules", () => {
  const asks = [
    ...generatedConfirmAsks(),
    ...validAskFixturesOf("confirm").map((fixture) => fixture.input),
  ];
  const cards = asks.map((input) => ({
    card: toSimpleCard({input, kind: "confirm", toolCallId: TOOL_CALL_ID}),
    input,
  }));

  it("covers generated asks and every confirm fixture", () => {
    expect(generatedConfirmAsks().length).toBeGreaterThan(100);
    expect(validAskFixturesOf("confirm").length).toBeGreaterThanOrEqual(4);
  });

  it("only generates asks that pass the full and compact rules", () => {
    for (const input of asks) {
      expect(validateAskInput({input, kind: "confirm"})).toEqual([]);
      expect(validateAskInput({input, kind: "confirm", surface: "compact"})).toEqual([]);
    }
  });

  it("derives cards that pass simpleCardSchema and never hand off", () => {
    for (const {card} of cards) {
      expect(simpleCardSchema.safeParse(card).success).toBe(true);
      expect(card.handoff).toBe(false);
    }
  });

  it("puts approve first and deny last, with no Skip even when the ask allows declining", () => {
    for (const {card, input} of cards) {
      expect(card.buttons.map(({id, response, style}) => ({id, response, style}))).toEqual(
        confirmButtons(input)
      );
    }
  });

  it("marks approve destructive exactly when the ask is, so Double Tap cannot approve it", () => {
    for (const {card, input} of cards) {
      const [approve] = card.buttons;
      expect(approve?.style === "destructive").toBe(input.destructive === true);
      expect(card.buttons.filter((button) => button.style !== "destructive").at(0)?.id).toBe(
        input.destructive === true ? "deny" : "approve"
      );
    }
  });

  it("shows the labels uncut, defaulting to Confirm and Cancel", () => {
    for (const {card, input} of cards) {
      expect(card.buttons.map((button) => button.label)).toEqual([
        input.confirmLabel ?? "Confirm",
        input.denyLabel ?? "Cancel",
      ]);
    }
  });

  it("only has buttons whose response is a valid answer to the ask", () => {
    for (const {card, input} of cards) {
      for (const button of card.buttons) {
        expect(validateAskResponse({input, kind: "confirm", response: button.response})).toEqual(
          []
        );
      }
    }
  });

  it("shows the labels without spaces at either end", () => {
    expect(
      toSimpleCard({
        input: {confirmLabel: " Send it ", denyLabel: "Wait ", prompt: "Send?"},
        kind: "confirm",
        toolCallId: TOOL_CALL_ID,
      }).buttons.map((button) => button.label)
    ).toEqual(["Send it", "Wait"]);
  });
});

const MARKDOWN_CAP = ASK_LIMITS.markdown.maxLength;

/** Drafts at, above, and below each length rule, with the bounds they are measured against. */
const MARKDOWN_LENGTH_CASES: {fits: boolean; input: Omit<MarkdownAskInput, "prompt">}[] = [
  {fits: true, input: {}},
  {fits: true, input: {initial: "x".repeat(MARKDOWN_CAP)}},
  {fits: true, input: {initial: "x".repeat(10), maxLength: 10}},
  {fits: false, input: {initial: "x".repeat(11), maxLength: 10}},
  {fits: true, input: {initial: "😀".repeat(5), maxLength: 10}},
  {fits: false, input: {initial: "😀".repeat(6), maxLength: 10}},
  {fits: true, input: {initial: "  twelve chars  ", minLength: 12}},
  {fits: false, input: {initial: "  eleven chr  ", minLength: 12}},
  {fits: false, input: {minLength: 1}},
  {fits: true, input: {initial: "Exactly", maxLength: 7, minLength: 7}},
];

describe("toSimpleCard markdown rules", () => {
  const asks = MARKDOWN_LENGTH_CASES.flatMap(({fits, input}) =>
    [undefined, true, false].flatMap((allowDecline) =>
      [undefined, "t".repeat(80)].map((title) => ({
        fits,
        input: {
          prompt: "Edit the draft, then send it back.",
          ...input,
          ...(allowDecline === undefined ? {} : {allowDecline}),
          ...(title === undefined ? {} : {title}),
        } satisfies MarkdownAskInput,
      }))
    )
  );
  const cards = asks.map(({fits, input}) => ({
    card: toSimpleCard({input, kind: "markdown", toolCallId: TOOL_CALL_ID}),
    fits,
    input,
  }));

  it("only generates valid asks", () => {
    for (const {input} of asks) {
      expect(validateAskInput({input, kind: "markdown"})).toEqual([]);
    }
  });

  it("always hands off, because a draft cannot be edited on a small screen", () => {
    for (const {card} of cards) {
      expect(simpleCardSchema.safeParse(card).success).toBe(true);
      expect(card.handoff).toBe(true);
    }
  });

  it("offers Approve draft exactly when the draft meets the length rules, then Cancel", () => {
    for (const {card, fits, input} of cards) {
      expect(card.buttons.map(({id, response, style}) => ({id, response, style}))).toEqual(
        markdownButtons(input, fits)
      );
    }
  });

  it("labels the buttons Approve draft and Cancel", () => {
    const card = toSimpleCard({
      input: {initial: "Hello", prompt: "Edit it."},
      kind: "markdown",
      toolCallId: TOOL_CALL_ID,
    });
    expect(card.buttons.map((button) => button.label)).toEqual(["Approve draft", "Cancel"]);
  });

  it("only has buttons whose response is a valid answer to the ask", () => {
    for (const {card, input} of cards) {
      for (const button of card.buttons) {
        expect(validateAskResponse({input, kind: "markdown", response: button.response})).toEqual(
          []
        );
      }
    }
  });
});
