import {describe, expect, it} from "bun:test";

import * as terrenoBlocks from "./index";

/**
 * Guards the public entrypoint of @terreno/blocks: a missing or renamed export here breaks
 * @terreno/ai, @terreno/ui, and apps, and the per-module tests import the modules directly.
 */
describe("@terreno/blocks public exports", () => {
  const expectedExports = [
    "ASK_ERROR_CODES",

    "askResponseWithToolCallIdSchema",
    "askSurfaceSchema",
    "pendingAskListItemSchema",
    "pendingAskListSchema",
    "pendingAskSummarySchema",
    "turnRequestSchema",
    "turnResultSchema",

    "askJsonSchemas",

    "ASK_LIMITS",

    "askPromptSection",

    "ASK_CANCEL_REASONS",
    "ASK_KINDS",
    "ASK_SURFACES",
    "CHOICE_SELECT_MODES",
    "COMPACT_ASK_KINDS",
    "askAcceptResponseSchema",
    "askCancelResponseSchema",
    "askDeclineResponseSchema",
    "askInputSchemaFor",
    "askInputSchemas",
    "askKindsForSurface",
    "askOutputSchemas",
    "askResponseSchema",
    "choiceAnswerSchema",
    "choiceAskInputSchema",
    "choiceAskResponseSchema",
    "choiceOptionSchema",
    "choiceSelectionBounds",
    "compactAskInputSchemas",
    "compactChoiceAskInputSchema",

    "SIMPLE_CARD_BUTTON_STYLES",
    "resolveButtonAnswer",
    "simpleCardButtonSchema",
    "simpleCardSchema",
    "toSimpleCard",

    "validateAskInput",
    "validateAskResponse",
  ];

  it("exports exactly the public runtime API", () => {
    expect(Object.keys(terrenoBlocks).sort()).toEqual([...expectedExports].sort());
  });
});
