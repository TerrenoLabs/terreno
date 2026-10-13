import type {z} from "zod";
import {ASK_LIMITS} from "./limits";

/**
 * Every ask error code, with its meaning. `validateAskInput` and `validateAskResponse` return all
 * of them except `UNKNOWN_BUTTON`, which the headless `turn` endpoint returns, and
 * `FILE_NOT_OWNED`, which the server returns when it loads an uploaded file.
 */
export const ASK_ERROR_CODES = {
  CHANGED_MISMATCH:
    "A markdown answer's changed flag does not match whether its text differs from the draft.",
  DECLINE_NOT_ALLOWED: "The answer skips an ask that does not allow skipping.",
  DEFAULT_NOT_IN_OPTIONS: "A default names an option id that the ask does not offer.",
  DUPLICATE_ID:
    "An id appears twice where ids must be unique: options, default, accept, or an answer.",
  DUPLICATE_LABEL:
    "Two buttons would share a label: options of a compact ask, or a confirm's approve and deny.",
  FIELD_TYPE_MISMATCH:
    "A form value or default does not fit its field's type: the wrong JSON type, not a whole number, or not a valid email, URL, or phone number.",
  FILE_COUNT: "A files answer has fewer files than minFiles or more than maxFiles.",
  FILE_NOT_OWNED:
    "A files answer names a fileId that is not an upload of the caller, or the host has no file storage.",
  FILE_TOO_LARGE: "A file is larger than the host's per-file upload cap.",
  FILE_TYPE_NOT_ACCEPTED: "A file's declared type is not one the ask's accept list allows.",
  INVALID_DATE:
    "A form date, time, or datetime value or default is not a real ISO 8601 value in the field's format.",
  INVALID_ENUM: "A value is not one of the allowed values.",
  INVALID_FORMAT: "A string does not match its required format.",
  INVALID_TYPE: "A value has the wrong type.",
  MIME_MISMATCH:
    "A file's bytes, or its data URL's media type, do not match the type the answer declares.",
  MISSING_REQUIRED: "A required field is missing.",
  OPTION_NOT_OFFERED: "The answer selects an option id that the ask did not offer.",
  OTHER_NOT_ALLOWED: "An ask or an answer uses Other where the ask does not allow it.",
  OUT_OF_RANGE: "A form number value or default is below the field's min or above its max.",
  RANGE_INVALID:
    "A count or length bound is out of range: below its minimum, above what the ask offers, or a minimum above its maximum.",
  REQUIRED_FIELD: "A form answer leaves a required field missing or blank.",
  SELECTION_COUNT: "A default or an answer selects the wrong number of options.",
  TOO_FEW: "A list has fewer items than allowed.",
  TOO_LONG: "A string is longer than allowed.",
  TOO_MANY: "A list has more items than allowed.",
  TOO_SHORT: "A string is empty, only whitespace, or shorter than its minimum.",
  UNKNOWN_BUTTON: "The pressed button is not on the pending ask's simple card.",
  UNKNOWN_KEY: "An object has a field that its schema does not define.",
} as const;

export type AskErrorCode = keyof typeof ASK_ERROR_CODES;

export interface AskValidationError {
  /** A key of `ASK_ERROR_CODES`. */
  code: AskErrorCode;
  /** One instruction that fixes the error. */
  fix: string;
  /** What is wrong, in one sentence. */
  message: string;
  /** Where the error is, such as `options[2].id`. The root is an empty string. */
  path: string;
}

/** An error before sorting; `segments` keeps array indexes numeric so they sort correctly. */
export interface AskErrorDraft {
  code: AskErrorCode;
  fix: string;
  message: string;
  segments: readonly PropertyKey[];
}

const MAX_QUOTED_LENGTH = 40;

const isAskErrorCode = (value: unknown): value is AskErrorCode =>
  typeof value === "string" && Object.hasOwn(ASK_ERROR_CODES, value);

export const formatAskPath = (segments: readonly PropertyKey[]): string =>
  segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") {
      return `${path}[${segment}]`;
    }
    const key = String(segment);
    return path === "" ? key : `${path}.${key}`;
  }, "");

/** A Zod custom issue that carries an ask error code and its fix. */
export const askIssue = ({
  code,
  fix,
  message,
  segments,
}: AskErrorDraft): {
  code: "custom";
  message: string;
  params: {askCode: AskErrorCode; fix: string};
  path: PropertyKey[];
} => ({code: "custom", message, params: {askCode: code, fix}, path: [...segments]});

export const quoteValue = (value: unknown): string => {
  if (typeof value !== "string") {
    return String(value);
  }
  const shortened =
    value.length > MAX_QUOTED_LENGTH ? `${value.slice(0, MAX_QUOTED_LENGTH - 1)}…` : value;
  return JSON.stringify(shortened);
};

const sentenceSubject = (path: string): string => (path === "" ? "The value" : path);

const inlineSubject = (path: string): string => (path === "" ? "the value" : path);

const describeExpected = (expected: string): string => {
  switch (expected) {
    case "array":
    case "tuple":
      return "a list";
    case "boolean":
      return "true or false";
    case "int":
      return "a whole number";
    case "number":
      return "a number";
    case "map":
    case "object":
    case "record":
      return "an object";
    case "string":
      return "a string";
    default:
      return expected;
  }
};

const describeReceived = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a list";
  }
  switch (typeof value) {
    case "boolean":
      return "a boolean";
    case "number":
      return "a number";
    case "object":
      return "an object";
    case "string":
      return "a string";
    default:
      return typeof value;
  }
};

const isPrimitive = (value: unknown): boolean =>
  value === null || ["boolean", "number", "string"].includes(typeof value);

const lookup = (
  root: unknown,
  segments: readonly PropertyKey[]
): {found: boolean; value: unknown} => {
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !(segment in current)) {
      return {found: false, value: undefined};
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return {found: current !== undefined, value: current};
};

const missingRequired = (segments: readonly PropertyKey[]): AskErrorDraft => {
  const path = formatAskPath(segments);
  const lastSegment = segments.at(-1);
  if (typeof lastSegment !== "string") {
    return {
      code: "MISSING_REQUIRED",
      fix: `Send ${inlineSubject(path)}.`,
      message: `${sentenceSubject(path)} is required.`,
      segments,
    };
  }
  const parentPath = formatAskPath(segments.slice(0, -1));
  return {
    code: "MISSING_REQUIRED",
    fix: parentPath === "" ? `Add "${lastSegment}".` : `Add "${lastSegment}" to ${parentPath}.`,
    message: `${path} is required.`,
    segments,
  };
};

const invalidEnum = (
  segments: readonly PropertyKey[],
  allowed: readonly unknown[],
  received: unknown
): AskErrorDraft => {
  const path = formatAskPath(segments);
  const allowedText =
    allowed.length === 1
      ? quoteValue(allowed[0])
      : `one of ${allowed.map((value) => quoteValue(value)).join(", ")}`;
  const receivedText = isPrimitive(received) ? `, not ${quoteValue(received)}` : "";
  return {
    code: "INVALID_ENUM",
    fix: `Use ${allowedText}.`,
    message: `${sentenceSubject(path)} must be ${allowedText}${receivedText}.`,
    segments,
  };
};

const tooShort = (segments: readonly PropertyKey[]): AskErrorDraft => {
  const path = formatAskPath(segments);
  return {
    code: "TOO_SHORT",
    fix: `Write at least one visible character in ${inlineSubject(path)}.`,
    message: `${sentenceSubject(path)} must contain visible text.`,
    segments,
  };
};

const numberOutOfRange = (segments: readonly PropertyKey[], bound: string): AskErrorDraft => {
  const path = formatAskPath(segments);
  return {
    code: "RANGE_INVALID",
    fix: `Make ${inlineSubject(path)} ${bound}.`,
    message: `${sentenceSubject(path)} must be ${bound}.`,
    segments,
  };
};

const unionOptions = (issue: z.core.$ZodIssueInvalidUnion): readonly unknown[] =>
  "options" in issue && Array.isArray(issue.options) ? issue.options : [];

const describeIssue = (
  issue: z.core.$ZodIssue,
  root: unknown,
  prefix: readonly PropertyKey[]
): AskErrorDraft[] => {
  const segments = [...prefix, ...issue.path];
  const path = formatAskPath(segments);
  const target = lookup(root, issue.path);
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((key) => ({
        code: "UNKNOWN_KEY",
        fix: `Remove "${key}".`,
        message: `"${key}" is not a field of ${path === "" ? "this object" : path}.`,
        segments: [...segments, key],
      }));
    case "invalid_type": {
      if (!target.found) {
        return [missingRequired(segments)];
      }
      const expected = describeExpected(issue.expected);
      const received =
        issue.expected === "int" && typeof target.value === "number"
          ? String(target.value)
          : describeReceived(target.value);
      return [
        {
          code: "INVALID_TYPE",
          fix: `Make ${inlineSubject(path)} ${expected}.`,
          message: `${sentenceSubject(path)} must be ${expected}, not ${received}.`,
          segments,
        },
      ];
    }
    case "invalid_value":
      if (!target.found) {
        return [missingRequired(segments)];
      }
      return [invalidEnum(segments, issue.values, target.value)];
    case "invalid_union": {
      if (!target.found) {
        return [missingRequired(segments)];
      }
      const allowed = unionOptions(issue);
      if (allowed.length === 0) {
        return [
          {
            code: "INVALID_TYPE",
            fix: `Check ${inlineSubject(path)}.`,
            message: issue.message,
            segments,
          },
        ];
      }
      return [invalidEnum(segments, allowed, target.value)];
    }
    case "too_big": {
      const maximum = String(issue.maximum);
      if (issue.origin === "number") {
        return [numberOutOfRange(segments, `at most ${maximum}`)];
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return [
          {
            code: "TOO_MANY",
            fix: `Remove items from ${inlineSubject(path)} until it has ${maximum} or fewer.`,
            message: `${sentenceSubject(path)} has more than ${maximum} items.`,
            segments,
          },
        ];
      }
      return [
        {
          code: "TOO_LONG",
          fix: `Shorten ${inlineSubject(path)} to ${maximum} characters or fewer.`,
          message: `${sentenceSubject(path)} is longer than ${maximum} characters.`,
          segments,
        },
      ];
    }
    case "too_small": {
      if (issue.origin === "number") {
        return [numberOutOfRange(segments, `at least ${String(issue.minimum)}`)];
      }
      if (issue.origin === "array" || issue.origin === "set") {
        const minimum = String(issue.minimum);
        return [
          {
            code: "TOO_FEW",
            fix: `Add items to ${inlineSubject(path)} until it has at least ${minimum}.`,
            message: `${sentenceSubject(path)} has fewer than ${minimum} items.`,
            segments,
          },
        ];
      }
      return [tooShort(segments)];
    }
    case "invalid_format":
      if (issue.pattern === String(ASK_LIMITS.choice.optionIdPattern)) {
        const idKind = issue.path.length === 3 && issue.path[0] === "fields" ? "field" : "option";
        return [
          {
            code: "INVALID_FORMAT",
            fix: `Use 1-${ASK_LIMITS.choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit.`,
            message: `${sentenceSubject(path)} ${quoteValue(target.value)} is not a valid ${idKind} id.`,
            segments,
          },
        ];
      }
      return [
        {
          code: "INVALID_FORMAT",
          fix: `Change ${inlineSubject(path)} to match the ${issue.format} format.`,
          message: `${sentenceSubject(path)} does not match the ${issue.format} format.`,
          segments,
        },
      ];
    case "custom": {
      const askCode = issue.params?.askCode;
      const fix = issue.params?.fix;
      if (askCode === "TOO_SHORT") {
        return [tooShort(segments)];
      }
      if (isAskErrorCode(askCode) && typeof fix === "string") {
        return [{code: askCode, fix, message: issue.message, segments}];
      }
      return [
        {
          code: "INVALID_FORMAT",
          fix: `Check ${inlineSubject(path)}.`,
          message: issue.message,
          segments,
        },
      ];
    }
    default:
      return [
        {
          code: "INVALID_TYPE",
          fix: `Check ${inlineSubject(path)}.`,
          message: issue.message,
          segments,
        },
      ];
  }
};

/**
 * Maps Zod issues to ask errors. `root` is the value that was parsed; it tells a missing key apart
 * from a key with the wrong type. `prefix` is prepended to every path.
 */
export const issuesToAskErrors = ({
  issues,
  prefix = [],
  root,
}: {
  issues: readonly z.core.$ZodIssue[];
  prefix?: readonly PropertyKey[];
  root: unknown;
}): AskErrorDraft[] => {
  const typeIssuePaths = new Set(
    issues
      .filter((issue) => issue.code === "invalid_type")
      .map((issue) => formatAskPath(issue.path))
  );
  return issues.flatMap((issue) => {
    if (issue.code !== "invalid_type" && typeIssuePaths.has(formatAskPath(issue.path))) {
      return [];
    }
    return describeIssue(issue, root, prefix);
  });
};

const compareStrings = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

const compareSegments = (left: readonly PropertyKey[], right: readonly PropertyKey[]): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      continue;
    }
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    if (typeof a === "number") {
      return -1;
    }
    if (typeof b === "number") {
      return 1;
    }
    return compareStrings(String(a), String(b));
  }
  return left.length - right.length;
};

/** Sorts drafts by path (array indexes in numeric order), then by code, and drops duplicates. */
export const finalizeAskErrors = (drafts: readonly AskErrorDraft[]): AskValidationError[] => {
  const sorted = [...drafts].sort(
    (left, right) =>
      compareSegments(left.segments, right.segments) || compareStrings(left.code, right.code)
  );
  const seen = new Set<string>();
  return sorted.flatMap((draft) => {
    const path = formatAskPath(draft.segments);
    const key = `${path}\u0000${draft.code}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{code: draft.code, fix: draft.fix, message: draft.message, path}];
  });
};
