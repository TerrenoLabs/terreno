import {z} from "zod";
import {askIssue, formatAskPath, quoteValue} from "./errors";
import {ASK_FILE_ACCEPT, type AskFileAccept, parseAskDataUrl} from "./files";
import {checkFormValue, formTextMaxLength} from "./formValues";
import {ASK_LIMITS} from "./limits";

/** Ask kinds in the catalog. Each kind is offered to the model as the tool `ask_<kind>`. */
export const ASK_KINDS = ["choice", "confirm", "markdown", "form", "files"] as const;

export type AskKind = (typeof ASK_KINDS)[number];

/**
 * Where the user answers. `compact` is a small screen, such as a watch: the model is offered only
 * asks whose simple card shows every option, so the user never has to continue on a phone.
 */
export const ASK_SURFACES = ["full", "compact"] as const;

export type AskSurface = (typeof ASK_SURFACES)[number];

/** Ask kinds the compact surface offers, each with a narrowed input schema. */
export const COMPACT_ASK_KINDS = ["choice", "confirm"] as const satisfies readonly AskKind[];

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

/** How many options a `choice` lets the user pick. */
export const CHOICE_SELECT_MODES = ["one", "many"] as const;

export type ChoiceSelectMode = (typeof CHOICE_SELECT_MODES)[number];

/** The fields of a `choice` input that its semantic rules read. */
interface ChoiceRuleInput {
  allowOther?: boolean;
  default?: string[];
  maxSelected?: number;
  minSelected?: number;
  options: ChoiceOption[];
  otherLabel?: string;
  select: ChoiceSelectMode;
}

/**
 * How many choices an answer to a `choice` must make, counting a typed Other answer as one.
 * `select: "one"` is always exactly one. `select: "many"` defaults to at least 1 and at most every
 * choice the ask offers: each option, plus Other when `allowOther` is true.
 */
export const choiceSelectionBounds = (input: ChoiceRuleInput): {max: number; min: number} => {
  if (input.select === "one") {
    return {max: 1, min: 1};
  }
  const choiceCount = input.options.length + (input.allowOther === true ? 1 : 0);
  return {max: input.maxSelected ?? choiceCount, min: input.minSelected ?? 1};
};

const pluralOptions = (count: number): string => (count === 1 ? "1 choice" : `${count} choices`);

const checkDuplicateIds = ({
  ctx,
  fix,
  ids,
  message,
  segments,
}: {
  ctx: z.RefinementCtx;
  fix: string;
  ids: readonly string[];
  message: (id: string, firstIndex: number) => string;
  segments: (index: number) => PropertyKey[];
}): Map<string, number> => {
  const firstIndexById = new Map<string, number>();
  ids.forEach((id, index) => {
    const firstIndex = firstIndexById.get(id);
    if (firstIndex === undefined) {
      firstIndexById.set(id, index);
      return;
    }
    ctx.addIssue(
      askIssue({
        code: "DUPLICATE_ID",
        fix,
        message: message(id, firstIndex),
        segments: segments(index),
      })
    );
  });
  return firstIndexById;
};

/** `select: "one"` picks exactly one option; count bounds and Other belong to `select: "many"`. */
const checkSelectOne = (input: ChoiceRuleInput, ctx: z.RefinementCtx): void => {
  for (const field of ["minSelected", "maxSelected"] as const) {
    const value = input[field];
    if (value === undefined || value === 1) {
      continue;
    }
    ctx.addIssue(
      askIssue({
        code: "RANGE_INVALID",
        fix: `Remove ${field}, or use select "many".`,
        message: `select "one" picks exactly one option, so ${field} must be 1, not ${value}.`,
        segments: [field],
      })
    );
  }
  if (input.allowOther === true) {
    ctx.addIssue(
      askIssue({
        code: "OTHER_NOT_ALLOWED",
        fix: 'Use select "many" (with maxSelected 1 for a single pick), or remove allowOther.',
        message: 'allowOther needs select "many".',
        segments: ["allowOther"],
      })
    );
  }
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
};

const checkSelectMany = (input: ChoiceRuleInput, ctx: z.RefinementCtx): void => {
  const choiceCount = input.options.length + (input.allowOther === true ? 1 : 0);
  const {max, min} = choiceSelectionBounds(input);
  if (input.maxSelected !== undefined && input.maxSelected > choiceCount) {
    ctx.addIssue(
      askIssue({
        code: "RANGE_INVALID",
        fix: `Set maxSelected to ${choiceCount} or fewer, or add options.`,
        message: `maxSelected is ${input.maxSelected}, but the ask offers ${pluralOptions(choiceCount)}.`,
        segments: ["maxSelected"],
      })
    );
  }
  if (min > Math.min(max, choiceCount)) {
    const limit =
      input.maxSelected === undefined
        ? `the ${pluralOptions(choiceCount)} the ask offers`
        : `maxSelected (${max})`;
    ctx.addIssue(
      askIssue({
        code: "RANGE_INVALID",
        fix: "Lower minSelected, or raise maxSelected and add options.",
        message: `minSelected (${min}) is more than ${limit}.`,
        segments: ["minSelected"],
      })
    );
  }
  const defaults = input.default ?? [];
  if (defaults.length > max) {
    ctx.addIssue(
      askIssue({
        code: "SELECTION_COUNT",
        fix: `Keep at most ${max} option ids in default.`,
        message: `default lists ${defaults.length} option ids, but the ask allows at most ${max}.`,
        segments: ["default"],
      })
    );
  }
  checkDuplicateIds({
    ctx,
    fix: "List each option id in default once.",
    ids: defaults,
    message: (id, firstIndex) =>
      `Default ${quoteValue(id)} is already listed at ${formatAskPath(["default", firstIndex])}.`,
    segments: (index) => ["default", index],
  });
};

const checkChoiceInput = (input: ChoiceRuleInput, ctx: z.RefinementCtx): void => {
  const firstIndexById = checkDuplicateIds({
    ctx,
    fix: "Give every option a unique id.",
    ids: input.options.map((option) => option.id),
    message: (id, firstIndex) =>
      `Option id ${quoteValue(id)} is already used by ${formatAskPath(["options", firstIndex])}.`,
    segments: (index) => ["options", index, "id"],
  });

  if (input.select === "many") {
    checkSelectMany(input, ctx);
  } else {
    checkSelectOne(input, ctx);
  }
  if (input.otherLabel !== undefined && input.allowOther !== true) {
    ctx.addIssue(
      askIssue({
        code: "OTHER_NOT_ALLOWED",
        fix: "Set allowOther to true, or remove otherLabel.",
        message: "otherLabel is set, but allowOther is not true.",
        segments: ["otherLabel"],
      })
    );
  }

  const defaults = input.default ?? [];
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
const checkButtonLabelLength = ({
  ctx,
  label,
  segments,
}: {
  ctx: z.RefinementCtx;
  label: string;
  segments: PropertyKey[];
}): void => {
  const {buttonLabelMaxLength} = ASK_LIMITS.simpleCard;
  if (label.length <= buttonLabelMaxLength) {
    return;
  }
  const path = formatAskPath(segments);
  ctx.addIssue(
    askIssue({
      code: "TOO_LONG",
      fix: `Shorten ${path} to ${buttonLabelMaxLength} characters or fewer, or use fewer emoji.`,
      message: `${path} is longer than ${buttonLabelMaxLength} characters, counting each emoji as 2 or more.`,
      segments,
    })
  );
};

/**
 * A label as its button shows it. Spaces at either end don't show, so "Go " and "Go" look the same
 * and are compared, and put on simple card buttons, without them.
 */
export const visibleLabel = (label: string): string => label.trim();

/** Says why two labels that differ only in spaces at either end count as the same. */
const spacesNote = (label: string, otherLabel: string): string =>
  label === otherLabel ? "" : ", ignoring spaces at either end";

const checkCompactChoiceInput = (input: ChoiceRuleInput, ctx: z.RefinementCtx): void => {
  checkChoiceInput(input, ctx);
  const firstIndexByLabel = new Map<string, number>();
  input.options.forEach((option, index) => {
    checkButtonLabelLength({ctx, label: option.label, segments: ["options", index, "label"]});
    const firstIndex = firstIndexByLabel.get(visibleLabel(option.label));
    if (firstIndex === undefined) {
      firstIndexByLabel.set(visibleLabel(option.label), index);
      return;
    }
    const note = spacesNote(option.label, input.options[firstIndex].label);
    ctx.addIssue(
      askIssue({
        code: "DUPLICATE_LABEL",
        fix: "Give every option a different label.",
        message: `Option label ${quoteValue(option.label)} is already used by ${formatAskPath(["options", firstIndex])}${note}.`,
        segments: ["options", index, "label"],
      })
    );
  });
};

const choiceBaseFields = ({
  defaultDescription,
  labelMaxLength,
  optionsMax,
}: {
  defaultDescription: string;
  labelMaxLength: number;
  optionsMax: number;
}) => ({
  ...sharedAskFields,
  default: z.array(z.string()).max(optionsMax).optional().describe(defaultDescription),
  options: z
    .array(choiceOption(labelMaxLength))
    .min(ASK_LIMITS.choice.optionsMin)
    .max(optionsMax)
    .describe(
      `The options, in display order: ${ASK_LIMITS.choice.optionsMin}-${optionsMax} items.`
    ),
});

/** Input for `ask_choice`: pick one option, or several with `select: "many"`, from a list. */
export const choiceAskInputSchema = z
  .object({
    ...choiceBaseFields({
      defaultDescription:
        'Option ids to preselect. With select "one", at most one id; with select "many", at most maxSelected ids.',
      labelMaxLength: ASK_LIMITS.choice.optionLabelMaxLength,
      optionsMax: ASK_LIMITS.choice.optionsMax,
    }),
    allowOther: z
      .boolean()
      .optional()
      .describe(
        `With select "many": add a free-text Other entry. The answer's other holds its text, at most ${ASK_LIMITS.choice.otherMaxLength} characters, and counts as one choice.`
      ),
    maxSelected: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'With select "many": the most choices the user may make. Defaults to every choice: the option count, plus 1 with allowOther.'
      ),
    minSelected: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'With select "many": the fewest choices the user must make. Defaults to 1. 0 lets the user submit no choice.'
      ),
    otherLabel: visibleText(ASK_LIMITS.choice.optionLabelMaxLength)
      .optional()
      .describe(
        `Label for the Other entry when allowOther is true, at most ${ASK_LIMITS.choice.optionLabelMaxLength} characters. Defaults to "Other".`
      ),
    select: z
      .enum(CHOICE_SELECT_MODES)
      .describe('How many options the user picks: "one", or "many" (checkboxes).'),
  })
  .strict()
  .superRefine(checkChoiceInput);

export type ChoiceAskInput = z.infer<typeof choiceAskInputSchema>;

/**
 * Input for `ask_choice` on the compact surface: pick one option by tapping its button, so the
 * card never hands off. At most 3 options, labels of at most 20 characters (each emoji counts as 2
 * or more), and no two labels alike. `select: "many"` and Other are not offered.
 */
export const compactChoiceAskInputSchema = z
  .object({
    ...choiceBaseFields({
      defaultDescription: 'Option ids to preselect. With select "one", at most one id.',
      labelMaxLength: ASK_LIMITS.simpleCard.buttonLabelMaxLength,
      optionsMax: ASK_LIMITS.simpleCard.buttonsMax,
    }),
    select: z.literal("one").describe('How many options the user picks. Only "one" is supported.'),
  })
  .strict()
  .superRefine(checkCompactChoiceInput);

/** The button labels a `confirm` ask shows when it does not name its own. */
const CONFIRM_DEFAULT_LABELS = {confirm: "Confirm", deny: "Cancel"} as const;

/** The fields of a `confirm` input that its semantic rules read. */
interface ConfirmRuleInput {
  confirmLabel?: string;
  denyLabel?: string;
}

/** The labels of a `confirm` ask's approve and deny buttons, with the defaults filled in. */
export const confirmButtonLabels = (input: ConfirmRuleInput): {confirm: string; deny: string} => ({
  confirm: input.confirmLabel ?? CONFIRM_DEFAULT_LABELS.confirm,
  deny: input.denyLabel ?? CONFIRM_DEFAULT_LABELS.deny,
});

/**
 * Both labels fit a simple card button uncut, so every surface shows the same words, and they
 * differ, so the user can tell approve from deny.
 */
const checkConfirmInput = (input: ConfirmRuleInput, ctx: z.RefinementCtx): void => {
  for (const field of ["confirmLabel", "denyLabel"] as const) {
    const label = input[field];
    if (label !== undefined) {
      checkButtonLabelLength({ctx, label, segments: [field]});
    }
  }
  const {confirm, deny} = confirmButtonLabels(input);
  if (visibleLabel(confirm) !== visibleLabel(deny)) {
    return;
  }
  const note = spacesNote(confirm, deny);
  if (input.denyLabel === undefined) {
    ctx.addIssue(
      askIssue({
        code: "DUPLICATE_LABEL",
        fix: `Give confirmLabel a label other than ${quoteValue(deny)}, the deny button's label.`,
        message: `confirmLabel ${quoteValue(confirm)} is the same as the deny button's label${note}.`,
        segments: ["confirmLabel"],
      })
    );
    return;
  }
  ctx.addIssue(
    askIssue({
      code: "DUPLICATE_LABEL",
      fix: `Give denyLabel a label other than ${quoteValue(confirm)}, the approve button's label.`,
      message: `denyLabel ${quoteValue(deny)} is the same as the approve button's label${note}.`,
      segments: ["denyLabel"],
    })
  );
};

const confirmLabelField = (button: "approve" | "deny", fallback: string) =>
  visibleText(ASK_LIMITS.confirm.labelMaxLength)
    .optional()
    .describe(
      `Label for the ${button} button, at most ${ASK_LIMITS.confirm.labelMaxLength} characters. Defaults to "${fallback}".`
    );

/**
 * Input for `ask_confirm`: approve or deny one action. It has no Submit, so no `submitLabel`, and
 * `allowDecline` defaults to false because deny is already the negative answer.
 */
export const confirmAskInputSchema = z
  .object({
    allowDecline: z
      .boolean()
      .optional()
      .describe(
        "Show a Skip button as well as deny. Defaults to false, because deny is the negative answer."
      ),
    confirmLabel: confirmLabelField("approve", CONFIRM_DEFAULT_LABELS.confirm),
    denyLabel: confirmLabelField("deny", CONFIRM_DEFAULT_LABELS.deny),
    destructive: z
      .boolean()
      .optional()
      .describe(
        "True when the action deletes data or cannot be undone. The approve button then shows as destructive. Defaults to false."
      ),
    prompt: sharedAskFields.prompt,
    title: sharedAskFields.title,
  })
  .strict()
  .superRefine(checkConfirmInput);

export type ConfirmAskInput = z.infer<typeof confirmAskInputSchema>;

/** The fields of a `markdown` input that its length rules read. */
interface MarkdownRuleInput {
  initial?: string;
  maxLength?: number;
  minLength?: number;
}

/**
 * How long an answer to a `markdown` ask may be. `max` counts UTF-16 code units (the `length` of a
 * JavaScript string, so most emoji count as 2 or more) and defaults to the 20,000 cap. `min`
 * counts the text without spaces at either end and defaults to 0.
 */
export const markdownLengthBounds = (input: MarkdownRuleInput): {max: number; min: number} => ({
  max: input.maxLength ?? ASK_LIMITS.markdown.maxLength,
  min: input.minLength ?? 0,
});

/**
 * Checks a draft's length against the cap in UTF-16 code units. Zod counts code points, so a draft
 * with emoji could otherwise pass Zod and still be longer than a text field lets the user keep.
 */
const checkMarkdownCap = ({
  ctx,
  segments,
  value,
}: {
  ctx: z.RefinementCtx;
  segments: PropertyKey[];
  value: string;
}): void => {
  const cap = ASK_LIMITS.markdown.maxLength;
  if (value.length <= cap) {
    return;
  }
  const path = formatAskPath(segments);
  ctx.addIssue(
    askIssue({
      code: "TOO_LONG",
      fix: `Shorten ${path} to ${cap} characters or fewer.`,
      message: `${path} is longer than ${cap} characters.`,
      segments,
    })
  );
};

/**
 * `minLength` must not be above `maxLength`, or no answer could be sent. An `initial` draft outside
 * the bounds is valid: the user edits it to fit, and the simple card offers no Approve draft.
 */
const checkMarkdownInput = (input: MarkdownRuleInput, ctx: z.RefinementCtx): void => {
  if (input.initial !== undefined) {
    checkMarkdownCap({ctx, segments: ["initial"], value: input.initial});
  }
  const {max, min} = markdownLengthBounds(input);
  if (min <= max) {
    return;
  }
  const limit = input.maxLength === undefined ? `the ${max}-character cap` : `maxLength (${max})`;
  ctx.addIssue(
    askIssue({
      code: "RANGE_INVALID",
      fix: "Lower minLength, or raise maxLength.",
      message: `minLength (${min}) is more than ${limit}.`,
      segments: ["minLength"],
    })
  );
};

/** Input for `ask_markdown`: the user edits a markdown draft and sends it back. */
export const markdownAskInputSchema = z
  .object({
    ...sharedAskFields,
    initial: z
      .string()
      .max(ASK_LIMITS.markdown.maxLength)
      .optional()
      .describe(
        `The draft the user starts from, in markdown, at most ${ASK_LIMITS.markdown.maxLength} characters. Defaults to empty.`
      ),
    maxLength: z
      .number()
      .int()
      .min(1)
      .max(ASK_LIMITS.markdown.maxLength)
      .optional()
      .describe(
        `The longest answer the user may send, in characters. Defaults to ${ASK_LIMITS.markdown.maxLength}, the most allowed.`
      ),
    minLength: z
      .number()
      .int()
      .min(0)
      .max(ASK_LIMITS.markdown.maxLength)
      .optional()
      .describe(
        "The shortest answer the user may send, in characters, not counting spaces at either end. Defaults to 0."
      ),
    placeholder: visibleText(ASK_LIMITS.markdown.placeholderMaxLength)
      .optional()
      .describe(
        `Hint text shown while the editor is empty, at most ${ASK_LIMITS.markdown.placeholderMaxLength} characters.`
      ),
  })
  .strict()
  .superRefine(checkMarkdownInput);

export type MarkdownAskInput = z.infer<typeof markdownAskInputSchema>;

/** The field types a `form` offers. Every field is flat: no nesting and no conditional fields. */
export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "url",
  "phone",
  "number",
  "date",
  "time",
  "datetime",
  "boolean",
  "select",
  "multiselect",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

const formFieldBase = <Type extends FormFieldType>(type: Type) => ({
  helperText: visibleText(ASK_LIMITS.form.helperTextMaxLength)
    .optional()
    .describe(
      `One line under the field, at most ${ASK_LIMITS.form.helperTextMaxLength} characters.`
    ),
  id: z
    .string()
    .regex(ASK_LIMITS.choice.optionIdPattern)
    .describe(
      `The key of this field's value in the answer: 1-${ASK_LIMITS.choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the form.`
    ),
  label: visibleText(ASK_LIMITS.form.labelMaxLength).describe(
    `What the user sees, at most ${ASK_LIMITS.form.labelMaxLength} characters.`
  ),
  required: z
    .boolean()
    .optional()
    .describe(
      "True when the answer must hold a non-blank value for this field. Defaults to false."
    ),
  type: z.literal(type),
});

const formTextField = <Type extends "text" | "textarea">(type: Type, cap: number) =>
  z
    .object({
      ...formFieldBase(type),
      default: z.string().optional().describe("The text the field starts with."),
      maxLength: z
        .number()
        .int()
        .min(1)
        .max(cap)
        .optional()
        .describe(`The most characters the value may have. Defaults to ${cap}, the most allowed.`),
      minLength: z
        .number()
        .int()
        .min(0)
        .max(cap)
        .optional()
        .describe(
          "The fewest characters a non-blank value may have, not counting spaces at either end. Defaults to 0."
        ),
    })
    .strict();

const formStringField = <Type extends "email" | "url" | "phone">(type: Type, example: string) =>
  z
    .object({
      ...formFieldBase(type),
      default: z
        .string()
        .optional()
        .describe(`The value the field starts with, such as ${example}.`),
    })
    .strict();

const formDateField = <Type extends "date" | "time" | "datetime">(type: Type, format: string) =>
  z
    .object({
      ...formFieldBase(type),
      default: z.string().optional().describe(`The value the field starts with, as ${format}.`),
    })
    .strict();

const formOption = z
  .object({
    id: choiceOptionSchema.shape.id,
    label: choiceOptionSchema.shape.label,
  })
  .strict();

const formOptions = formOption
  .array()
  .min(ASK_LIMITS.choice.optionsMin)
  .max(ASK_LIMITS.choice.optionsMax)
  .describe(
    `The options, in display order: ${ASK_LIMITS.choice.optionsMin}-${ASK_LIMITS.choice.optionsMax} items, each {id, label}.`
  );

export const formFieldSchema = z.discriminatedUnion("type", [
  formTextField("text", ASK_LIMITS.form.textMaxLength),
  formTextField("textarea", ASK_LIMITS.form.textareaMaxLength),
  formStringField("email", '"ada@example.com"'),
  formStringField("url", '"https://example.com"'),
  formStringField("phone", '"+1 415 555 2671"'),
  z
    .object({
      ...formFieldBase("number"),
      default: z.number().optional().describe("The number the field starts with."),
      integer: z.boolean().optional().describe("True to accept whole numbers only."),
      max: z.number().optional().describe("The largest value allowed."),
      min: z.number().optional().describe("The smallest value allowed."),
    })
    .strict(),
  formDateField("date", 'YYYY-MM-DD, such as "2026-10-01"'),
  formDateField("time", '24-hour HH:mm, such as "09:30"'),
  formDateField(
    "datetime",
    'an ISO 8601 date and time with Z or an offset, seconds optional, such as "2026-10-01T09:30Z"'
  ),
  z
    .object({
      ...formFieldBase("boolean"),
      default: z.boolean().optional().describe("Whether the checkbox starts checked."),
    })
    .strict(),
  z
    .object({
      ...formFieldBase("select"),
      default: z.string().optional().describe("The option id selected at first."),
      options: formOptions,
    })
    .strict(),
  z
    .object({
      ...formFieldBase("multiselect"),
      default: z
        .array(z.string())
        .optional()
        .describe("The option ids selected at first, each listed once."),
      options: formOptions,
    })
    .strict(),
]);

export type FormField = z.infer<typeof formFieldSchema>;

/**
 * Field ids are unique, length and number bounds have their minimum at or below their maximum,
 * option ids are unique within a field, and every default is a value its field accepts.
 */
const checkFormInput = (input: {fields: FormField[]}, ctx: z.RefinementCtx): void => {
  checkDuplicateIds({
    ctx,
    fix: "Give every field a unique id.",
    ids: input.fields.map((field) => field.id),
    message: (id, firstIndex) =>
      `Field id ${quoteValue(id)} is already used by ${formatAskPath(["fields", firstIndex])}.`,
    segments: (index) => ["fields", index, "id"],
  });
  input.fields.forEach((field, index) => {
    if ((field.type === "text" || field.type === "textarea") && field.minLength !== undefined) {
      const max = formTextMaxLength(field);
      if (field.minLength > max) {
        ctx.addIssue(
          askIssue({
            code: "RANGE_INVALID",
            fix: "Lower minLength, or raise maxLength.",
            message: `minLength (${field.minLength}) is more than maxLength (${max}).`,
            segments: ["fields", index, "minLength"],
          })
        );
      }
    }
    if (
      field.type === "number" &&
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      ctx.addIssue(
        askIssue({
          code: "RANGE_INVALID",
          fix: "Lower min, or raise max.",
          message: `min (${field.min}) is more than max (${field.max}).`,
          segments: ["fields", index, "min"],
        })
      );
    }
    if (field.type === "select" || field.type === "multiselect") {
      checkDuplicateIds({
        ctx,
        fix: "Give every option of the field a unique id.",
        ids: field.options.map((option) => option.id),
        message: (id, firstIndex) =>
          `Option id ${quoteValue(id)} is already used by ${formatAskPath(["fields", index, "options", firstIndex])}.`,
        segments: (optionIndex) => ["fields", index, "options", optionIndex, "id"],
      });
    }
    if (field.default === undefined) {
      return;
    }
    for (const draft of checkFormValue({
      field,
      isDefault: true,
      segments: ["fields", index, "default"],
      value: field.default,
    })) {
      ctx.addIssue(askIssue(draft));
    }
  });
};

/** Input for `ask_form`: a few flat fields the user fills in and submits at once. */
export const formAskInputSchema = z
  .object({
    ...sharedAskFields,
    fields: z
      .array(formFieldSchema)
      .min(ASK_LIMITS.form.fieldsMin)
      .max(ASK_LIMITS.form.fieldsMax)
      .describe(
        `The fields, in display order: ${ASK_LIMITS.form.fieldsMin}-${ASK_LIMITS.form.fieldsMax} items. Each has a type (${FORM_FIELD_TYPES.join(", ")}).`
      ),
  })
  .strict()
  .superRefine(checkFormInput);

export type FormAskInput = z.infer<typeof formAskInputSchema>;

/** The `content` of an accepted answer from any client, before its values meet their fields. */
export const formAnswerEnvelopeSchema = z
  .object({values: z.record(z.string(), z.unknown())})
  .strict();

/**
 * The `content` of an accepted `form` answer: one value per answered field, keyed by field id.
 * Unanswered optional fields are left out.
 */
export const formAnswerSchema = z
  .object({
    values: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    ),
  })
  .strict();

export type FormAnswer = z.infer<typeof formAnswerSchema>;

/** The fields of a `files` input that its count rules read. */
interface FilesRuleInput {
  accept: AskFileAccept[];
  maxFiles?: number;
  minFiles?: number;
}

/** How many files an answer to a `files` ask must carry: 1 to 10 unless the ask narrows it. */
export const filesCountBounds = (input: FilesRuleInput): {max: number; min: number} => ({
  max: input.maxFiles ?? ASK_LIMITS.files.maxFiles,
  min: input.minFiles ?? ASK_LIMITS.files.minFiles,
});

const checkFilesInput = (input: FilesRuleInput, ctx: z.RefinementCtx): void => {
  checkDuplicateIds({
    ctx,
    fix: "List each accept value once.",
    ids: input.accept,
    message: (value, firstIndex) =>
      `${quoteValue(value)} is already listed at ${formatAskPath(["accept", firstIndex])}.`,
    segments: (index) => ["accept", index],
  });
  const {max, min} = filesCountBounds(input);
  if (min <= max) {
    return;
  }
  const limit =
    input.maxFiles === undefined ? `the ${max}-file cap` : `maxFiles (${input.maxFiles})`;
  ctx.addIssue(
    askIssue({
      code: "RANGE_INVALID",
      fix: "Lower minFiles, or raise maxFiles.",
      message: `minFiles (${min}) is more than ${limit}.`,
      segments: ["minFiles"],
    })
  );
};

const fileCountField = (description: string) =>
  z
    .number()
    .int()
    .min(ASK_LIMITS.files.minFiles)
    .max(ASK_LIMITS.files.maxFiles)
    .optional()
    .describe(description);

/** Input for `ask_files`: the user uploads one or more images or documents. */
export const filesAskInputSchema = z
  .object({
    ...sharedAskFields,
    accept: z
      .array(z.enum(ASK_FILE_ACCEPT))
      .min(1)
      .max(ASK_FILE_ACCEPT.length)
      .describe(
        'The kinds of file the user may send, each listed once: "image" (JPEG, PNG, GIF, WebP), "pdf", "text" (plain text), "csv", or "json".'
      ),
    maxFiles: fileCountField(
      `The most files the user may send: ${ASK_LIMITS.files.minFiles}-${ASK_LIMITS.files.maxFiles}. Defaults to ${ASK_LIMITS.files.maxFiles}.`
    ),
    minFiles: fileCountField(
      `The fewest files the user must send: ${ASK_LIMITS.files.minFiles}-${ASK_LIMITS.files.maxFiles}. Defaults to ${ASK_LIMITS.files.minFiles}.`
    ),
  })
  .strict()
  .superRefine(checkFilesInput);

export type FilesAskInput = z.infer<typeof filesAskInputSchema>;

/**
 * Exactly one of `fileId` and `url` names the bytes. A `url` must be a base64 `data:` URL whose
 * media type is the declared `mimeType`, so the server never fetches a remote URL.
 */
const checkFileRef = (ref: {fileId?: string; url?: string}, ctx: z.RefinementCtx): void => {
  if (ref.fileId === undefined && ref.url === undefined) {
    ctx.addIssue(
      askIssue({
        code: "MISSING_REQUIRED",
        fix: 'Add "fileId" (an upload from POST /files/upload) or "url" (a base64 data: URL).',
        message: "A file needs a fileId or a url.",
        segments: [],
      })
    );
    return;
  }
  if (ref.fileId !== undefined && ref.url !== undefined) {
    ctx.addIssue(
      askIssue({
        code: "INVALID_FORMAT",
        fix: "Send fileId or url, not both.",
        message: "A file has both a fileId and a url.",
        segments: ["url"],
      })
    );
    return;
  }
  if (ref.url !== undefined && parseAskDataUrl(ref.url) === undefined) {
    ctx.addIssue(
      askIssue({
        code: "INVALID_FORMAT",
        fix: 'Send the bytes as a base64 data: URL, such as "data:image/png;base64,...".',
        message: "url is not a base64 data: URL.",
        segments: ["url"],
      })
    );
  }
};

/** One file in an accepted `files` answer: an upload (`fileId`) or inline bytes (`url`). */
export const askFileRefSchema = z
  .object({
    fileId: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("The id of the user's upload from POST /files/upload."),
    filename: visibleText(ASK_LIMITS.files.filenameMaxLength).describe(
      "The file's name as the user picked it."
    ),
    mimeType: z.string().min(1).max(127).describe('The file\'s MIME type, such as "image/png".'),
    size: z.number().int().min(0).describe("The file's size in bytes."),
    url: z.string().optional().describe("The file's bytes as a base64 data: URL."),
  })
  .strict()
  .superRefine(checkFileRef);

export type AskFileRef = z.infer<typeof askFileRefSchema>;

/** The `content` of an accepted `files` answer: the files the user sent, in the order they chose. */
export const filesAnswerSchema = z.object({files: z.array(askFileRefSchema)}).strict();

export type FilesAnswer = z.infer<typeof filesAnswerSchema>;

/** The `content` of an accepted `choice` answer. */
export const choiceAnswerSchema = z
  .object({
    other: visibleText(ASK_LIMITS.choice.otherMaxLength).optional(),
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

/** The `content` of an accepted `confirm` answer: true approves the action, false denies it. */
export const confirmAnswerSchema = z.object({confirmed: z.boolean()}).strict();

export type ConfirmAnswer = z.infer<typeof confirmAnswerSchema>;

/** The answer envelope for `ask_confirm`, with `content` typed. Used as the tool's output schema. */
export const confirmAskResponseSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("accept"), content: confirmAnswerSchema}).strict(),
  askDeclineResponseSchema,
  askCancelResponseSchema,
]);

export type ConfirmAskResponse = z.infer<typeof confirmAskResponseSchema>;

/**
 * The `content` of an accepted `markdown` answer: the text the user sends back, and whether it
 * differs from the ask's `initial` draft.
 */
export const markdownAnswerSchema = z
  .object({
    changed: z.boolean(),
    markdown: z.string().max(ASK_LIMITS.markdown.maxLength),
  })
  .strict()
  .superRefine((answer, ctx) => {
    checkMarkdownCap({ctx, segments: ["markdown"], value: answer.markdown});
  });

export type MarkdownAnswer = z.infer<typeof markdownAnswerSchema>;

/** The answer envelope for `ask_markdown`, with `content` typed. Used as the tool's output schema. */
export const markdownAskResponseSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("accept"), content: markdownAnswerSchema}).strict(),
  askDeclineResponseSchema,
  askCancelResponseSchema,
]);

export type MarkdownAskResponse = z.infer<typeof markdownAskResponseSchema>;

/** The answer envelope for `ask_form`, with `content` typed. Used as the tool's output schema. */
export const formAskResponseSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("accept"), content: formAnswerSchema}).strict(),
  askDeclineResponseSchema,
  askCancelResponseSchema,
]);

export type FormAskResponse = z.infer<typeof formAskResponseSchema>;

/** The answer envelope for `ask_files`, with `content` typed. Used as the tool's output schema. */
export const filesAskResponseSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("accept"), content: filesAnswerSchema}).strict(),
  askDeclineResponseSchema,
  askCancelResponseSchema,
]);

export type FilesAskResponse = z.infer<typeof filesAskResponseSchema>;

/** Input schemas by kind. */
export const askInputSchemas = {
  choice: choiceAskInputSchema,
  confirm: confirmAskInputSchema,
  files: filesAskInputSchema,
  form: formAskInputSchema,
  markdown: markdownAskInputSchema,
} as const satisfies Record<AskKind, z.ZodType>;

/** Input schemas by kind on the compact surface. Every compact input is also a valid full input. */
export const compactAskInputSchemas = {
  choice: compactChoiceAskInputSchema,
  // A confirm always fits a simple card (two buttons with labels that show uncut).
  confirm: confirmAskInputSchema,
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
}): (typeof askInputSchemas)[AskKind] | (typeof compactAskInputSchemas)[CompactAskKind] => {
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
  confirm: confirmAskResponseSchema,
  files: filesAskResponseSchema,
  form: formAskResponseSchema,
  markdown: markdownAskResponseSchema,
} as const satisfies Record<AskKind, z.ZodType>;

export interface ChoiceAsk {
  input: ChoiceAskInput;
  kind: "choice";
}

export interface ConfirmAsk {
  input: ConfirmAskInput;
  kind: "confirm";
}

export interface MarkdownAsk {
  input: MarkdownAskInput;
  kind: "markdown";
}

export interface FormAsk {
  input: FormAskInput;
  kind: "form";
}

export interface FilesAsk {
  input: FilesAskInput;
  kind: "files";
}

/** A validated ask: its kind and its input. */
export type Ask = ChoiceAsk | ConfirmAsk | MarkdownAsk | FormAsk | FilesAsk;

/**
 * Whether the user may skip the ask. `allowDecline` defaults to true, except on `confirm`, where
 * deny is already the negative answer.
 */
export const askAllowsDecline = ({input, kind}: Ask): boolean =>
  kind === "confirm" ? input.allowDecline === true : input.allowDecline !== false;
