import {describe, expect, it} from "bun:test";

import * as terrenoBlocks from "./index";

/**
 * Guards the public entrypoint of @terreno/blocks: a missing or renamed export here breaks
 * @terreno/ai, @terreno/ui, and apps, and the per-module tests import the modules directly.
 */
describe("@terreno/blocks public exports", () => {
  const expectedExports = [
    "BADGE_STATUSES",
    "BLOCK_ERROR_CODES",
    "BLOCK_LIMITS",
    "BLOCK_WARNING_CODES",
    "BUTTON_VARIANTS",
    "CALLOUT_STATUSES",
    "CHART_HEIGHTS",
    "CHART_KINDS",
    "COPY_TARGET_TYPES",
    "DATASET_COLUMN_TYPES",
    "DATASET_GRAINS",
    "HEADING_SIZES",
    "HTML_HEIGHTS",
    "METRIC_TRENDS",
    "STEPPER_ROUNDING",
    "applyChecklistState",
    "blockPlainText",
    "blocksJsonSchema",
    "blocksPromptSection",
    "blocksSchema",
    "checklistElementId",
    "isStepperValueAllowed",
    "parseBlocks",
    "parseBlocksPartial",
    "scaleStepperBlock",
    "stepperElementIds",
    "unknownChecklistItemIds",
    "validateBlocks",
    "wrapAsTextDocument",

    "ASK_ERROR_CODES",

    "ASK_FILE_ACCEPT",
    "ASK_FILE_ACCEPT_MIME_TYPES",
    "acceptedFileMimeTypes",
    "checkAskFileBytes",
    "fileNotOwnedError",
    "isTextFileMimeType",
    "parseAskDataUrl",
    "sniffFileBytes",

    "askResponseWithToolCallIdSchema",
    "askSurfaceSchema",
    "pendingAskListItemSchema",
    "pendingAskListSchema",
    "pendingAskSummarySchema",
    "turnRequestSchema",
    "turnResultSchema",

    "askJsonSchemas",

    "formDefaultValues",
    "formTextMaxLength",

    "ASK_LIMITS",

    "askPromptSection",

    "ASK_CANCEL_REASONS",
    "ASK_KINDS",
    "ASK_SURFACES",
    "CHOICE_SELECT_MODES",
    "COMPACT_ASK_KINDS",
    "askAcceptResponseSchema",
    "askAllowsDecline",
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
    "confirmAnswerSchema",
    "confirmAskInputSchema",
    "confirmAskResponseSchema",
    "confirmButtonLabels",
    "FORM_FIELD_TYPES",
    "askFileRefSchema",
    "filesAnswerSchema",
    "filesAskInputSchema",
    "filesAskResponseSchema",
    "filesCountBounds",
    "formAnswerSchema",
    "formAskInputSchema",
    "formAskResponseSchema",
    "formFieldSchema",
    "isCompactAskKind",
    "markdownAnswerSchema",
    "markdownAskInputSchema",
    "markdownAskResponseSchema",
    "markdownLengthBounds",

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
