import {z} from "zod";
import {askIssue, formatAskPath, quoteValue} from "./errors";
import {ASK_LIMITS} from "./limits";

/** Ask kinds in the catalog. Each kind is offered to the model as the tool `ask_<kind>`. */
export const ASK_KINDS = ["choice"] as const;

export type AskKind = (typeof ASK_KINDS)[number];

/** Reasons the server records when it answers an ask with `cancel` on the user's behalf. */
export const ASK_CANCEL_REASONS = {
  oneAskAtATime: "one_ask_at_a_time",
  userSentMessage: "user_sent_message",
} as const;

const visibleText = (maxLength: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.length === 0 || value.trim().length > 0, {
      message: "Must contain visible text, not only whitespace.",
      params: {askCode: "TOO_SHORT"},
    });

const sharedAskFields = {
  allowDecline: z
    .boolean()
    .optional()
    .describe("Show a Skip button so the user can decline to answer. Defaults to true."),
  prompt: visibleText(ASK_LIMITS.promptMaxLength).describe(
    `The question for the user, in plain text: no markdown and no links. 1-${ASK_LIMITS.promptMaxLength} characters.`
  ),
  submitLabel: visibleText(ASK_LIMITS.submitLabelMaxLength)
    .optional()
    .describe(
      `Label for the submit button, at most ${ASK_LIMITS.submitLabelMaxLength} characters. Defaults to "Submit".`
    ),
  title: visibleText(ASK_LIMITS.titleMaxLength)
    .optional()
    .describe(
      `A short heading above the question, at most ${ASK_LIMITS.titleMaxLength} characters.`
    ),
};

export const choiceOptionSchema = z
  .object({
    description: visibleText(ASK_LIMITS.choice.optionDescriptionMaxLength)
      .optional()
      .describe(
        `One line under the label, at most ${ASK_LIMITS.choice.optionDescriptionMaxLength} characters.`
      ),
    id: z
      .string()
      .regex(ASK_LIMITS.choice.optionIdPattern)
      .describe(
        `Stable id returned in the answer: 1-${ASK_LIMITS.choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.`
      ),
    label: visibleText(ASK_LIMITS.choice.optionLabelMaxLength).describe(
      `What the user sees, at most ${ASK_LIMITS.choice.optionLabelMaxLength} characters.`
    ),
  })
  .strict();

export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

const checkChoiceInput = (
  input: {default?: string[]; options: ChoiceOption[]},
  ctx: z.RefinementCtx
): void => {
  const firstIndexById = new Map<string, number>();
  input.options.forEach((option, index) => {
    const firstIndex = firstIndexById.get(option.id);
    if (firstIndex === undefined) {
      firstIndexById.set(option.id, index);
      return;
    }
    ctx.addIssue(
      askIssue({
        code: "DUPLICATE_ID",
        fix: "Give every option a unique id.",
        message: `Option id ${quoteValue(option.id)} is already used by ${formatAskPath(["options", firstIndex])}.`,
        segments: ["options", index, "id"],
      })
    );
  });

  const defaults = input.default ?? [];
  if (defaults.length > 1) {
    ctx.addIssue(
      askIssue({
        code: "SELECTION_COUNT",
        fix: "Keep one option id in default, or remove default.",
        message: `default lists ${defaults.length} option ids, but select "one" allows one.`,
        segments: ["default"],
      })
    );
  }
  defaults.forEach((id, index) => {
    if (firstIndexById.has(id)) {
      return;
    }
    ctx.addIssue(
      askIssue({
        code: "DEFAULT_NOT_IN_OPTIONS",
        fix: "Use an id from options, or remove it from default.",
        message: `Default ${quoteValue(id)} is not the id of any option.`,
        segments: ["default", index],
      })
    );
  });
};

/** Input for `ask_choice`: pick one option from a list. */
export const choiceAskInputSchema = z
  .object({
    ...sharedAskFields,
    default: z
      .array(z.string())
      .max(ASK_LIMITS.choice.optionsMax)
      .optional()
      .describe('Option ids to preselect. With select "one", at most one id.'),
    options: z
      .array(choiceOptionSchema)
      .min(ASK_LIMITS.choice.optionsMin)
      .max(ASK_LIMITS.choice.optionsMax)
      .describe(
        `The options, in display order: ${ASK_LIMITS.choice.optionsMin}-${ASK_LIMITS.choice.optionsMax} items.`
      ),
    select: z.literal("one").describe('How many options the user picks. Only "one" is supported.'),
  })
  .strict()
  .superRefine(checkChoiceInput);

export type ChoiceAskInput = z.infer<typeof choiceAskInputSchema>;

/** The `content` of an accepted `choice` answer. */
export const choiceAnswerSchema = z
  .object({
    selected: z.array(z.string()).max(ASK_LIMITS.choice.optionsMax),
  })
  .strict();

export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;

export const askAcceptResponseSchema = z
  .object({
    action: z.literal("accept"),
    content: z.record(z.string(), z.unknown()),
  })
  .strict();

export const askDeclineResponseSchema = z.object({action: z.literal("decline")}).strict();

export const askCancelResponseSchema = z
  .object({
    action: z.literal("cancel"),
    reason: visibleText(ASK_LIMITS.cancelReasonMaxLength).optional(),
  })
  .strict();

/**
 * The answer envelope for every ask (the MCP elicitation shape). `accept` carries the kind's
 * answer in `content`; `decline` means the user pressed Skip; `cancel` means the ask was dropped.
 */
export const askResponseSchema = z.discriminatedUnion("action", [
  askAcceptResponseSchema,
  askDeclineResponseSchema,
  askCancelResponseSchema,
]);

export type AskResponse = z.infer<typeof askResponseSchema>;

/** The answer envelope for `ask_choice`, with `content` typed. Used as the tool's output schema. */
export const choiceAskResponseSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("accept"), content: choiceAnswerSchema}).strict(),
  askDeclineResponseSchema,
  askCancelResponseSchema,
]);

export type ChoiceAskResponse = z.infer<typeof choiceAskResponseSchema>;

/** Input schemas by kind. */
export const askInputSchemas = {
  choice: choiceAskInputSchema,
} as const satisfies Record<AskKind, z.ZodType>;

/** Output (answer envelope) schemas by kind. */
export const askOutputSchemas = {
  choice: choiceAskResponseSchema,
} as const satisfies Record<AskKind, z.ZodType>;

export interface ChoiceAsk {
  input: ChoiceAskInput;
  kind: "choice";
}

/** A validated ask: its kind and its input. */
export type Ask = ChoiceAsk;
