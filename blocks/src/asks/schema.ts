import {z} from "zod";
import {askIssue, formatAskPath, quoteValue} from "./errors";
import {ASK_LIMITS} from "./limits";

/** Ask kinds in the catalog. Each kind is offered to the model as the tool `ask_<kind>`. */
export const ASK_KINDS = ["choice"] as const;

export type AskKind = (typeof ASK_KINDS)[number];

/**
 * Where the user answers. `compact` is a small screen, such as a watch: the model is offered only
 * asks whose simple card shows every option, so the user never has to continue on a phone.
 */
export const ASK_SURFACES = ["full", "compact"] as const;

export type AskSurface = (typeof ASK_SURFACES)[number];

/** Ask kinds the compact surface offers, each with a narrowed input schema. */
export const COMPACT_ASK_KINDS = ["choice"] as const satisfies readonly AskKind[];

export type CompactAskKind = (typeof COMPACT_ASK_KINDS)[number];

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

const choiceOption = (labelMaxLength: number) =>
  z
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
      label: visibleText(labelMaxLength).describe(
        `What the user sees, at most ${labelMaxLength} characters.`
      ),
    })
    .strict();

export const choiceOptionSchema = choiceOption(ASK_LIMITS.choice.optionLabelMaxLength);

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

/**
 * A compact ask shows each option as a button with its label uncut, so two options with the same
 * label would be two buttons the user cannot tell apart. Zod counts a label's length in code points,
 * but a simple card cuts labels by UTF-16 units, so a label with emoji can fit Zod's limit and still
 * be cut on its button.
 */
const checkCompactChoiceInput = (
  input: {default?: string[]; options: ChoiceOption[]},
  ctx: z.RefinementCtx
): void => {
  checkChoiceInput(input, ctx);
  const {buttonLabelMaxLength} = ASK_LIMITS.simpleCard;
  const firstIndexByLabel = new Map<string, number>();
  input.options.forEach((option, index) => {
    if (option.label.length > buttonLabelMaxLength) {
      const path = formatAskPath(["options", index, "label"]);
      ctx.addIssue(
        askIssue({
          code: "TOO_LONG",
          fix: `Shorten ${path} to ${buttonLabelMaxLength} characters or fewer, or use fewer emoji.`,
          message: `${path} is longer than ${buttonLabelMaxLength} characters, counting each emoji as 2 or more.`,
          segments: ["options", index, "label"],
        })
      );
    }
    const firstIndex = firstIndexByLabel.get(option.label);
    if (firstIndex === undefined) {
      firstIndexByLabel.set(option.label, index);
      return;
    }
    ctx.addIssue(
      askIssue({
        code: "DUPLICATE_LABEL",
        fix: "Give every option a different label.",
        message: `Option label ${quoteValue(option.label)} is already used by ${formatAskPath(["options", firstIndex])}.`,
        segments: ["options", index, "label"],
      })
    );
  });
};

const choiceAskInput = ({
  check,
  labelMaxLength,
  optionsMax,
}: {
  check: typeof checkChoiceInput;
  labelMaxLength: number;
  optionsMax: number;
}) =>
  z
    .object({
      ...sharedAskFields,
      default: z
        .array(z.string())
        .max(optionsMax)
        .optional()
        .describe('Option ids to preselect. With select "one", at most one id.'),
      options: z
        .array(choiceOption(labelMaxLength))
        .min(ASK_LIMITS.choice.optionsMin)
        .max(optionsMax)
        .describe(
          `The options, in display order: ${ASK_LIMITS.choice.optionsMin}-${optionsMax} items.`
        ),
      select: z
        .literal("one")
        .describe('How many options the user picks. Only "one" is supported.'),
    })
    .strict()
    .superRefine(check);

/** Input for `ask_choice`: pick one option from a list. */
export const choiceAskInputSchema = choiceAskInput({
  check: checkChoiceInput,
  labelMaxLength: ASK_LIMITS.choice.optionLabelMaxLength,
  optionsMax: ASK_LIMITS.choice.optionsMax,
});

export type ChoiceAskInput = z.infer<typeof choiceAskInputSchema>;

/**
 * Input for `ask_choice` on the compact surface: every option fits a simple card button, so the
 * card never hands off. At most 3 options, labels of at most 20 characters (each emoji counts as 2
 * or more), and no two labels alike.
 */
export const compactChoiceAskInputSchema = choiceAskInput({
  check: checkCompactChoiceInput,
  labelMaxLength: ASK_LIMITS.simpleCard.buttonLabelMaxLength,
  optionsMax: ASK_LIMITS.simpleCard.buttonsMax,
});

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

/** Input schemas by kind on the compact surface. Every compact input is also a valid full input. */
export const compactAskInputSchemas = {
  choice: compactChoiceAskInputSchema,
} as const satisfies Record<CompactAskKind, z.ZodType>;

export const isCompactAskKind = (kind: AskKind): kind is CompactAskKind =>
  (COMPACT_ASK_KINDS as readonly AskKind[]).includes(kind);

/** The kinds a surface offers, in the given order. The compact surface drops kinds it cannot show. */
export const askKindsForSurface = ({
  kinds,
  surface,
}: {
  kinds: readonly AskKind[];
  surface: AskSurface;
}): AskKind[] => (surface === "compact" ? kinds.filter(isCompactAskKind) : [...kinds]);

/**
 * The input schema for a kind on a surface. Throws for an unknown kind or surface, and when the
 * compact surface does not offer the kind.
 */
export const askInputSchemaFor = ({
  kind,
  surface = "full",
}: {
  kind: AskKind;
  surface?: AskSurface;
}): (typeof askInputSchemas)[AskKind] => {
  if (!Object.hasOwn(askInputSchemas, kind)) {
    throw new Error(`Unknown ask kind "${String(kind)}".`);
  }
  if (!ASK_SURFACES.includes(surface)) {
    throw new Error(`Unknown ask surface "${String(surface)}".`);
  }
  if (surface === "full") {
    return askInputSchemas[kind];
  }
  if (!isCompactAskKind(kind)) {
    throw new Error(`The compact surface does not offer ask kind "${String(kind)}".`);
  }
  return compactAskInputSchemas[kind];
};

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
