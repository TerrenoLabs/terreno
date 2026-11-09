import {z} from "zod";
import {type AskErrorCode, type AskErrorDraft, formatAskPath, quoteValue} from "./errors";
import {ASK_LIMITS} from "./limits";
import type {FormAskInput, FormField, FormFieldType} from "./schema";

/** A value a form answer holds for one field. */
export type FormValue = boolean | number | string | string[];

const emailSchema = z.email();
const urlSchema = z.url({protocol: /^https?$/});
const PHONE_CHARACTERS = /^\+?[0-9 ().-]+$/;
const NON_DIGITS = /\D/g;

/** The ISO 8601 shape each date field type takes, with an example for fixes. */
const DATE_FORMATS = {
  date: {example: "2026-10-01", format: "YYYY-MM-DD", schema: z.iso.date()},
  datetime: {
    example: "2026-10-01T09:30:00Z",
    format: "an ISO 8601 date and time with Z or an offset such as +02:00 (seconds optional)",
    schema: z.union([
      z.iso.datetime({offset: true, precision: -1}),
      z.iso.datetime({offset: true}),
    ]),
  },
  time: {example: "09:30", format: "HH:mm (24-hour)", schema: z.iso.time({precision: -1})},
} as const;

const TYPE_NAMES: Record<FormFieldType, string> = {
  boolean: "true or false",
  date: "a date string",
  datetime: "a datetime string",
  email: "an email address",
  multiselect: "a list of option ids",
  number: "a number",
  phone: "a phone number",
  select: "an option id",
  text: "a string",
  textarea: "a string",
  time: "a time string",
  url: "an http or https URL",
};

const characters = (count: number): string => (count === 1 ? "1 character" : `${count} characters`);

/** The longest value a field accepts, in UTF-16 code units. */
export const formTextMaxLength = (field: FormField): number => {
  if (field.type === "textarea") {
    return field.maxLength ?? ASK_LIMITS.form.textareaMaxLength;
  }
  if (field.type === "text") {
    return field.maxLength ?? ASK_LIMITS.form.textMaxLength;
  }
  return ASK_LIMITS.form.textMaxLength;
};

/**
 * Whether a value counts as unanswered: a string with no visible characters, or an empty list.
 * `false` and `0` are answers.
 */
export const isBlankFormValue = (value: unknown): boolean =>
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

interface CheckContext {
  field: FormField;
  /** True when the value is the field's `default` in an ask, not a user's answer. */
  isDefault: boolean;
  segments: readonly PropertyKey[];
}

const draft = (
  {segments}: CheckContext,
  code: AskErrorCode,
  message: string,
  fix: string
): AskErrorDraft => ({code, fix, message, segments});

const mismatch = (context: CheckContext, detail?: string): AskErrorDraft => {
  const path = formatAskPath(context.segments);
  const expected = TYPE_NAMES[context.field.type];
  return draft(
    context,
    "FIELD_TYPE_MISMATCH",
    detail ??
      `${path} must be ${expected} for the ${context.field.type} field "${context.field.id}".`,
    `Make ${path} ${expected}.`
  );
};

const checkLength = (context: CheckContext, value: string): AskErrorDraft[] => {
  const path = formatAskPath(context.segments);
  const max = formTextMaxLength(context.field);
  const drafts: AskErrorDraft[] = [];
  if (value.length > max) {
    drafts.push(
      draft(
        context,
        "TOO_LONG",
        `${path} is ${characters(value.length)}, but the field allows at most ${max}.`,
        `Shorten ${path} to ${characters(max)} or fewer.`
      )
    );
  }
  const {field} = context;
  const min = field.type === "text" || field.type === "textarea" ? (field.minLength ?? 0) : 0;
  const visibleLength = value.trim().length;
  if (visibleLength === 0 && context.isDefault) {
    drafts.push(
      draft(
        context,
        "TOO_SHORT",
        `${path} must contain visible text.`,
        `Write at least one visible character in ${path}, or remove it.`
      )
    );
  } else if (visibleLength < min) {
    drafts.push(
      draft(
        context,
        "TOO_SHORT",
        `${path} is ${characters(visibleLength)}, but the field needs at least ${min}.`,
        `Write at least ${characters(min)} in ${path}.`
      )
    );
  }
  return drafts;
};

const checkStringFormat = (context: CheckContext, value: string): AskErrorDraft[] => {
  const path = formatAskPath(context.segments);
  const {type} = context.field;
  if (type === "email" && !emailSchema.safeParse(value).success) {
    return [mismatch(context, `${path} ${quoteValue(value)} is not a valid email address.`)];
  }
  if (type === "url" && !urlSchema.safeParse(value).success) {
    return [mismatch(context, `${path} ${quoteValue(value)} is not an http or https URL.`)];
  }
  if (type === "phone") {
    const digits = value.replace(NON_DIGITS, "").length;
    const {phoneDigitsMax, phoneDigitsMin} = ASK_LIMITS.form;
    if (!PHONE_CHARACTERS.test(value) || digits < phoneDigitsMin || digits > phoneDigitsMax) {
      return [
        draft(
          context,
          "FIELD_TYPE_MISMATCH",
          `${path} ${quoteValue(value)} is not a valid phone number.`,
          `Make ${path} ${phoneDigitsMin}-${phoneDigitsMax} digits, optionally starting with "+", with only spaces, dots, dashes, or parentheses between them.`
        ),
      ];
    }
  }
  return [];
};

const checkNumber = (context: CheckContext, value: unknown): AskErrorDraft[] => {
  const {field} = context;
  if (field.type !== "number") {
    return [];
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [mismatch(context)];
  }
  const path = formatAskPath(context.segments);
  if (field.integer === true && !Number.isInteger(value)) {
    return [
      draft(
        context,
        "FIELD_TYPE_MISMATCH",
        `${path} is ${value}, but the field takes whole numbers only.`,
        `Make ${path} a whole number.`
      ),
    ];
  }
  if (field.min !== undefined && value < field.min) {
    return [
      draft(
        context,
        "OUT_OF_RANGE",
        `${path} is ${value}, below the field's min of ${field.min}.`,
        `Make ${path} at least ${field.min}.`
      ),
    ];
  }
  if (field.max !== undefined && value > field.max) {
    return [
      draft(
        context,
        "OUT_OF_RANGE",
        `${path} is ${value}, above the field's max of ${field.max}.`,
        `Make ${path} at most ${field.max}.`
      ),
    ];
  }
  return [];
};

const notOffered = (context: CheckContext, id: string, segments: PropertyKey[]): AskErrorDraft =>
  context.isDefault
    ? {
        code: "DEFAULT_NOT_IN_OPTIONS",
        fix: `Use an id from fields[${String(context.segments[1])}].options, or remove it from the default.`,
        message: `Default ${quoteValue(id)} is not the id of any option of the field.`,
        segments,
      }
    : {
        code: "OPTION_NOT_OFFERED",
        fix: `Use the id of one of the options of the field "${context.field.id}".`,
        message: `${quoteValue(id)} is not one of the field's options.`,
        segments,
      };

const checkOptions = (context: CheckContext, value: unknown): AskErrorDraft[] => {
  const {field} = context;
  if (field.type !== "select" && field.type !== "multiselect") {
    return [];
  }
  const offered = new Set(field.options.map((option) => option.id));
  if (field.type === "select") {
    if (typeof value !== "string") {
      return [mismatch(context)];
    }
    return offered.has(value) ? [] : [notOffered(context, value, [...context.segments])];
  }
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    return [mismatch(context)];
  }
  const path = formatAskPath(context.segments);
  if (value.length > ASK_LIMITS.choice.optionsMax) {
    return [
      draft(
        context,
        "TOO_MANY",
        `${path} has more than ${ASK_LIMITS.choice.optionsMax} items.`,
        `Remove items from ${path} until it has ${ASK_LIMITS.choice.optionsMax} or fewer.`
      ),
    ];
  }
  const firstIndexById = new Map<string, number>();
  return (value as string[]).flatMap((id, index): AskErrorDraft[] => {
    const segments = [...context.segments, index];
    const firstIndex = firstIndexById.get(id);
    if (firstIndex !== undefined) {
      return [
        {
          code: "DUPLICATE_ID",
          fix: `List each option id in ${path} once.`,
          message: `${quoteValue(id)} is already listed at ${formatAskPath([...context.segments, firstIndex])}.`,
          segments,
        },
      ];
    }
    firstIndexById.set(id, index);
    return offered.has(id) ? [] : [notOffered(context, id, segments)];
  });
};

/**
 * Checks one present value against its field: its JSON type, then the type's own rules (length,
 * format, range, calendar date, offered options). Used for every answer value and every default,
 * so a default is always a value the field accepts. Blank values are the caller's concern, except
 * that a blank default string fails with `TOO_SHORT`.
 */
export const checkFormValue = ({
  field,
  isDefault,
  segments,
  value,
}: CheckContext & {value: unknown}): AskErrorDraft[] => {
  const context: CheckContext = {field, isDefault, segments};
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? [] : [mismatch(context)];
    case "number":
      return checkNumber(context, value);
    case "select":
    case "multiselect":
      return checkOptions(context, value);
    case "date":
    case "time":
    case "datetime": {
      if (typeof value !== "string") {
        return [mismatch(context)];
      }
      const {example, format, schema} = DATE_FORMATS[field.type];
      if (schema.safeParse(value).success) {
        return [];
      }
      const path = formatAskPath(segments);
      return [
        draft(
          context,
          "INVALID_DATE",
          `${path} ${quoteValue(value)} is not a real ${field.type} in ${format}.`,
          `Write ${path} as ${format}, such as "${example}".`
        ),
      ];
    }
    default: {
      if (typeof value !== "string") {
        return [mismatch(context)];
      }
      const lengthDrafts = checkLength(context, value);
      if (lengthDrafts.length > 0 || value.trim() === "") {
        return lengthDrafts;
      }
      return checkStringFormat(context, value);
    }
  }
};

/**
 * The values a form starts with: each field's `default`, keyed by field id. Fields without a
 * default are left out.
 */
export const formDefaultValues = (input: FormAskInput): Record<string, FormValue> =>
  Object.fromEntries(
    input.fields.flatMap((field) =>
      field.default === undefined ? [] : [[field.id, field.default as FormValue]]
    )
  );
