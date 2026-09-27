import {describe, expect, it} from "bun:test";
import {validAskFixtures} from "../tests/askFixtures";
import type {ChoiceAskInput} from "./schema";
import {simpleCardSchema, toSimpleCard} from "./simpleCard";
import {validateAskResponse} from "./validateResponse";

const TOOL_CALL_ID = "call_fixture";

/** Rows of the `choice` one rule table in docs/reference/agent-ui-asks.md. */
type ChoiceRow = "optionsFit" | "moreOptions" | "labelsCollide";

/** The row each valid fixture exercises, read off the rule table by hand. */
const CHOICE_ROW_BY_FIXTURE: Record<string, ChoiceRow> = {
  "choice-emoji-label-cut": "optionsFit",
  "choice-labels-collide-after-cut": "labelsCollide",
  "choice-long-text-cut": "optionsFit",
  "choice-many-options-default-label-collides": "labelsCollide",
  "choice-many-options-no-buttons": "moreOptions",
  "choice-many-options-no-default": "moreOptions",
  "choice-many-options-with-default": "moreOptions",
  "choice-max-limits": "moreOptions",
  "choice-plan-with-default": "optionsFit",
  "choice-two-options": "optionsFit",
  "choice-two-options-no-decline": "optionsFit",
};

interface ExpectedButton {
  id: string;
  response: unknown;
  style: string;
}

const SKIP: ExpectedButton = {id: "skip", response: {action: "decline"}, style: "cancel"};

const selects = (id: string): unknown => ({action: "accept", content: {selected: [id]}});

/** The buttons a row allows for an input, without their labels, written from the rule table. */
const buttonsForRow = (input: ChoiceAskInput, row: ChoiceRow): ExpectedButton[] => {
  const skip = input.allowDecline === false ? [] : [SKIP];
  const defaultId = input.default?.[0];
  if (row === "labelsCollide") {
    return skip;
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
        const row = CHOICE_ROW_BY_FIXTURE[fixture.name];
        if (!row) {
          throw new Error(`Add valid/${fixture.name} to CHOICE_ROW_BY_FIXTURE.`);
        }
        expect(card.handoff).toBe(row !== "optionsFit");
        expect(card.buttons.map(({id, response, style}) => ({id, response, style}))).toEqual(
          buttonsForRow(fixture.input, row)
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
  it("lists exactly the valid fixtures", () => {
    expect(Object.keys(CHOICE_ROW_BY_FIXTURE).sort()).toEqual(
      validAskFixtures()
        .map((fixture) => fixture.name)
        .sort()
    );
  });

  it("uses optionsFit only for at most 3 options and moreOptions only for more", () => {
    for (const fixture of validAskFixtures()) {
      const row = CHOICE_ROW_BY_FIXTURE[fixture.name];
      if (row === "optionsFit") {
        expect(fixture.input.options.length).toBeLessThanOrEqual(3);
      }
      if (row === "moreOptions") {
        expect(fixture.input.options.length).toBeGreaterThan(3);
      }
    }
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
