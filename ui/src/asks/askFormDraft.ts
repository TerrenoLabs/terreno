import {
  type AskValidationError,
  type FormAskInput,
  type FormField,
  type FormValue,
  formTextMaxLength,
} from "@terreno/blocks";
import {parsePhoneNumberFromString} from "libphonenumber-js";
import {DateTime} from "luxon";

import {formatCount} from "./askSummary";

/**
 * What each form control edits: text for text-like, number, and date fields (dates in the answer's
 * ISO format), a boolean for checkboxes, and option ids for selects.
 */
export type FormDraftValue = boolean | string | string[];

export type FormDraft = Record<string, FormDraftValue>;

type DateFieldType = "date" | "datetime" | "time";

const ANSWER_PREVIEW_LENGTH = 80;
/** Plain decimal notation only, so "0x10" or "1e3" is not read as a different number than typed. */
const DECIMAL_TEXT = /^-?(?:\d+\.?\d*|\.\d+)$/;
const TIME_FORMAT = "HH:mm";
const WHITESPACE = /\s+/g;

/** The draft a form starts from: each field's default, or empty. Checkboxes start unchecked. */
export const initialFormDraft = (input: FormAskInput): FormDraft =>
  Object.fromEntries(
    input.fields.map((field): [string, FormDraftValue] => {
      switch (field.type) {
        case "boolean":
          return [field.id, field.default ?? false];
        case "multiselect":
          return [field.id, field.default ?? []];
        case "number":
          return [field.id, field.default === undefined ? "" : String(field.default)];
        default:
          return [field.id, field.default ?? ""];
      }
    })
  );

/** A valid phone number in E.164, read as a US number when it has no country code. */
const phoneAnswer = (text: string): string => {
  const parsed = parsePhoneNumberFromString(text, "US");
  return parsed?.isValid() ? parsed.number : text;
};

const draftAnswer = (field: FormField, draft: FormDraftValue): FormValue | undefined => {
  if (typeof draft === "boolean" || Array.isArray(draft)) {
    return Array.isArray(draft) && draft.length === 0 ? undefined : draft;
  }
  const text = draft.trim();
  if (text === "") {
    return undefined;
  }
  if (field.type === "number") {
    return DECIMAL_TEXT.test(text) ? Number(text) : text;
  }
  if (field.type === "phone") {
    return phoneAnswer(text);
  }
  return text;
};

/**
 * The answer's `values` for a draft. Blank fields are left out; checkboxes are always sent, since
 * unchecked is an answer. Text that does not parse stays text so validation can say why.
 */
export const formDraftValues = ({
  draft,
  input,
}: {
  draft: FormDraft;
  input: FormAskInput;
}): Record<string, FormValue> =>
  Object.fromEntries(
    input.fields.flatMap((field) => {
      const value = draftAnswer(field, draft[field.id] ?? "");
      return value === undefined ? [] : [[field.id, value]];
    })
  );

/** The UTC ISO value `DateTimeField` shows for an answer-format date, time, or datetime. */
export const toPickerValue = ({
  timezone,
  type,
  value,
}: {
  timezone: string;
  type: DateFieldType;
  value: string;
}): string | undefined => {
  if (value === "") {
    return undefined;
  }
  let parsed: DateTime;
  if (type === "date") {
    parsed = DateTime.fromISO(value, {zone: "UTC"});
  } else if (type === "time") {
    parsed = DateTime.fromFormat(value, TIME_FORMAT, {zone: timezone});
  } else {
    parsed = DateTime.fromISO(value, {setZone: true});
  }
  return parsed.isValid ? (parsed.toUTC().toISO() ?? undefined) : undefined;
};

/**
 * The answer-format value for what `DateTimeField` emitted: YYYY-MM-DD, 24-hour HH:mm in the
 * picker's timezone, or an ISO datetime with the picker timezone's offset.
 */
export const fromPickerValue = ({
  iso,
  timezone,
  type,
}: {
  iso: string;
  timezone: string;
  type: DateFieldType;
}): string => {
  if (iso === "") {
    return "";
  }
  if (type === "date") {
    return DateTime.fromISO(iso, {zone: "UTC"}).toISODate() ?? "";
  }
  const zoned = DateTime.fromISO(iso).setZone(timezone);
  if (type === "time") {
    return zoned.toFormat(TIME_FORMAT);
  }
  return zoned.toISO({suppressMilliseconds: true}) ?? "";
};

const characters = (count: number): string =>
  `${formatCount(count)} ${count === 1 ? "character" : "characters"}`;

const rangeText = (field: FormField): string | undefined => {
  if (field.type !== "number") {
    return undefined;
  }
  if (field.min !== undefined && field.max !== undefined) {
    return `Enter a number from ${field.min} to ${field.max}.`;
  }
  if (field.min !== undefined) {
    return `Enter a number of at least ${field.min}.`;
  }
  if (field.max !== undefined) {
    return `Enter a number of at most ${field.max}.`;
  }
  return undefined;
};

const MISMATCH_TEXT: Partial<Record<FormField["type"], string>> = {
  email: "Enter a valid email address.",
  phone: "Enter a valid phone number.",
  url: "Enter a web address that starts with http:// or https://.",
};

const INVALID_DATE_TEXT: Record<DateFieldType, string> = {
  date: "Enter a real date.",
  datetime: "Enter a real date and time.",
  time: "Enter a real time.",
};

const mismatchText = (field: FormField): string | undefined => {
  if (field.type === "number") {
    return field.integer === true ? "Enter a whole number." : "Enter a number.";
  }
  return MISMATCH_TEXT[field.type];
};

const friendlyText = (field: FormField, error: AskValidationError): string | undefined => {
  switch (error.code) {
    case "REQUIRED_FIELD":
      return "This field is required.";
    case "OUT_OF_RANGE":
      return rangeText(field);
    case "FIELD_TYPE_MISMATCH":
      return mismatchText(field);
    case "INVALID_DATE":
      return field.type === "date" || field.type === "time" || field.type === "datetime"
        ? INVALID_DATE_TEXT[field.type]
        : undefined;
    case "TOO_LONG":
      return `Keep this to ${characters(formTextMaxLength(field))} or fewer.`;
    case "TOO_SHORT": {
      const min = field.type === "text" || field.type === "textarea" ? field.minLength : undefined;
      return min ? `Write at least ${characters(min)}.` : undefined;
    }
    case "OPTION_NOT_OFFERED":
      return field.type === "select" ? "Choose one of the options." : undefined;
    default:
      return undefined;
  }
};

/** Whether an error's path points at a field's value or one of its items. */
export const isFormFieldError = (error: AskValidationError, field: FormField): boolean => {
  const path = `content.values.${field.id}`;
  return (
    error.path === path || error.path.startsWith(`${path}[`) || error.path.startsWith(`${path}.`)
  );
};

/**
 * Plain words for the first error on a field, such as "Enter a number from 1 to 500.", or the
 * error's own message when no plainer text fits.
 */
export const formFieldErrorText = ({
  errors,
  field,
}: {
  errors: AskValidationError[];
  field: FormField;
}): string | undefined => {
  const error = errors.find((candidate) => isFormFieldError(candidate, field));
  if (!error) {
    return undefined;
  }
  return friendlyText(field, error) ?? error.message;
};

const optionLabel = (
  field: Extract<FormField, {type: "multiselect" | "select"}>,
  id: string
): string => field.options.find((option) => option.id === id)?.label ?? id;

const formatNumber = (value: number): string => {
  const [whole = "", fraction] = String(value).split(".");
  return fraction === undefined
    ? formatCount(Number(whole))
    : `${formatCount(Number(whole))}.${fraction}`;
};

const formatDate = (type: DateFieldType, value: string): string => {
  if (type === "time") {
    const time = DateTime.fromFormat(value, TIME_FORMAT);
    return time.isValid ? time.toFormat("h:mm a") : value;
  }
  const parsed = DateTime.fromISO(value, {setZone: true});
  if (!parsed.isValid) {
    return value;
  }
  return parsed.toFormat(type === "date" ? "MMM d, yyyy" : "MMM d, yyyy, h:mm a ZZZZ");
};

const previewText = (value: string): string => {
  const text = value.replace(WHITESPACE, " ").trim();
  return text.length > ANSWER_PREVIEW_LENGTH
    ? `${text.slice(0, ANSWER_PREVIEW_LENGTH).trimEnd()}…`
    : text;
};

/**
 * One answered value as the user would read it: Yes or No, option labels, a readable date or
 * time, or text shortened to one line.
 */
export const formatFormValue = ({field, value}: {field: FormField; value: unknown}): string => {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((id) =>
        field.type === "multiselect" || field.type === "select"
          ? optionLabel(field, String(id))
          : String(id)
      )
      .join(", ");
  }
  if (typeof value !== "string") {
    return JSON.stringify(value) ?? "";
  }
  switch (field.type) {
    case "select":
    case "multiselect":
      return optionLabel(field, value);
    case "date":
    case "time":
    case "datetime":
      return formatDate(field.type, value);
    default:
      return previewText(value);
  }
};
