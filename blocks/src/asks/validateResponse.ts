import {
  type AskErrorDraft,
  type AskValidationError,
  finalizeAskErrors,
  formatAskPath,
  issuesToAskErrors,
  quoteValue,
} from "./errors";
import {acceptedFileMimeTypes, base64ByteLength, fileTooLargeDraft, parseAskDataUrl} from "./files";
import {checkFormValue, isBlankFormValue} from "./formValues";
import {ASK_LIMITS} from "./limits";
import {
  type Ask,
  type AskKind,
  askAllowsDecline,
  askResponseSchema,
  type ChoiceAskInput,
  choiceAnswerSchema,
  choiceSelectionBounds,
  confirmAnswerSchema,
  type FilesAskInput,
  type FormAskInput,
  filesAnswerSchema,
  filesCountBounds,
  formAnswerEnvelopeSchema,
  type MarkdownAskInput,
  markdownAnswerSchema,
  markdownLengthBounds,
} from "./schema";

const countText = (count: number): string => (count === 1 ? "1 option" : `${count} options`);

/** "exactly 2 options", "1 to 3 options", or "at most 3 options". */
const boundsText = ({max, min}: {max: number; min: number}): string => {
  if (min === max) {
    return `exactly ${countText(min)}`;
  }
  if (min === 0) {
    return `at most ${countText(max)}`;
  }
  return `${min} to ${countText(max)}`;
};

const selectionCountDraft = ({
  count,
  hasOther,
  input,
}: {
  count: number;
  hasOther: boolean;
  input: ChoiceAskInput;
}): AskErrorDraft => {
  const bounds = choiceSelectionBounds(input);
  if (input.select === "one") {
    return {
      code: "SELECTION_COUNT",
      fix: "Send exactly one option id in content.selected.",
      message: `Choose exactly one option; the answer selects ${count}.`,
      segments: ["content", "selected"],
    };
  }
  const otherNote = input.allowOther === true ? " Other counts as one choice." : "";
  return {
    code: "SELECTION_COUNT",
    fix: `Send ${boundsText(bounds)} in content.selected.${otherNote}`,
    message: `Choose ${boundsText(bounds)}; the answer selects ${count}${hasOther ? ", counting Other" : ""}.`,
    segments: ["content", "selected"],
  };
};

const validateChoiceAnswer = (input: ChoiceAskInput, content: unknown): AskErrorDraft[] => {
  const parsed = choiceAnswerSchema.safeParse(content);
  if (!parsed.success) {
    return issuesToAskErrors({issues: parsed.error.issues, prefix: ["content"], root: content});
  }
  const {other, selected} = parsed.data;
  const drafts: AskErrorDraft[] = [];
  const isOtherAllowed = input.allowOther === true;
  if (other !== undefined && !isOtherAllowed) {
    drafts.push({
      code: "OTHER_NOT_ALLOWED",
      fix: "Remove content.other and pick from the options.",
      message: "This ask does not accept an Other answer.",
      segments: ["content", "other"],
    });
  }
  const hasOther = other !== undefined && isOtherAllowed;
  const count = selected.length + (hasOther ? 1 : 0);
  const {max, min} = choiceSelectionBounds(input);
  if (count < min || count > max) {
    drafts.push(selectionCountDraft({count, hasOther, input}));
  }
  const offeredIds = new Set(input.options.map((option) => option.id));
  const firstIndexById = new Map<string, number>();
  selected.forEach((id, index) => {
    const firstIndex = firstIndexById.get(id);
    if (firstIndex !== undefined) {
      drafts.push({
        code: "DUPLICATE_ID",
        fix: "List each option id in content.selected once.",
        message: `${quoteValue(id)} is already selected at ${formatAskPath(["content", "selected", firstIndex])}.`,
        segments: ["content", "selected", index],
      });
      return;
    }
    firstIndexById.set(id, index);
    if (offeredIds.has(id)) {
      return;
    }
    drafts.push({
      code: "OPTION_NOT_OFFERED",
      fix: "Use the id of one of the ask's options.",
      message: `${quoteValue(id)} is not one of the offered options.`,
      segments: ["content", "selected", index],
    });
  });
  return drafts;
};

const validateConfirmAnswer = (content: unknown): AskErrorDraft[] => {
  const parsed = confirmAnswerSchema.safeParse(content);
  if (parsed.success) {
    return [];
  }
  return issuesToAskErrors({issues: parsed.error.issues, prefix: ["content"], root: content});
};

const characters = (count: number): string => (count === 1 ? "1 character" : `${count} characters`);

/**
 * The text must fit the ask's bounds, and `changed` must say truthfully whether it differs from
 * the draft, so the agent can trust `changed: false` to mean the user approved the draft as is.
 */
const markdownTooLong = (length: number, max: number): AskErrorDraft => ({
  code: "TOO_LONG",
  fix: `Shorten content.markdown to ${characters(max)} or fewer.`,
  message: `The text is ${characters(length)}, but this ask allows at most ${max}.`,
  segments: ["content", "markdown"],
});

const isMarkdownTooLong = ({code, segments}: AskErrorDraft): boolean =>
  code === "TOO_LONG" &&
  segments.length === 2 &&
  segments[0] === "content" &&
  segments[1] === "markdown";

const validateMarkdownAnswer = (input: MarkdownAskInput, content: unknown): AskErrorDraft[] => {
  const {max, min} = markdownLengthBounds(input);
  const parsed = markdownAnswerSchema.safeParse(content);
  if (!parsed.success) {
    const sent =
      typeof content === "object" && content !== null
        ? (content as {markdown?: unknown}).markdown
        : undefined;
    const length = typeof sent === "string" ? sent.length : 0;
    // The schema's 20,000 cap fires before the ask's own maxLength, so the fix names the tighter one.
    return issuesToAskErrors({issues: parsed.error.issues, prefix: ["content"], root: content}).map(
      (draft) => (isMarkdownTooLong(draft) ? markdownTooLong(length, max) : draft)
    );
  }
  const {changed, markdown} = parsed.data;
  const drafts: AskErrorDraft[] = [];
  if (markdown.length > max) {
    drafts.push(markdownTooLong(markdown.length, max));
  }
  const visibleLength = markdown.trim().length;
  if (visibleLength < min) {
    drafts.push({
      code: "TOO_SHORT",
      fix: `Write at least ${characters(min)} in content.markdown.`,
      message: `The text is ${characters(visibleLength)}, but this ask needs at least ${min}.`,
      segments: ["content", "markdown"],
    });
  }
  const isChanged = markdown !== (input.initial ?? "");
  if (changed !== isChanged) {
    drafts.push({
      code: "CHANGED_MISMATCH",
      fix: `Set content.changed to ${String(isChanged)}.`,
      message: isChanged
        ? "The text differs from the draft, but changed is false."
        : "The text is the same as the draft, but changed is true.",
      segments: ["content", "changed"],
    });
  }
  return drafts;
};

/**
 * Every value must belong to a field, every required field needs a non-blank value, and every
 * value must be one its field accepts. A blank value on an optional field counts as unanswered.
 */
const validateFormAnswer = (input: FormAskInput, content: unknown): AskErrorDraft[] => {
  const parsed = formAnswerEnvelopeSchema.safeParse(content);
  if (!parsed.success) {
    return issuesToAskErrors({issues: parsed.error.issues, prefix: ["content"], root: content});
  }
  const {values} = parsed.data;
  const fieldIds = new Set(input.fields.map((field) => field.id));
  const drafts: AskErrorDraft[] = Object.keys(values)
    .filter((id) => !fieldIds.has(id))
    .map((id) => ({
      code: "UNKNOWN_KEY",
      fix: `Remove ${quoteValue(id)} from content.values.`,
      message: `${quoteValue(id)} is not the id of any field in this form.`,
      segments: ["content", "values", id],
    }));
  for (const field of input.fields) {
    const segments = ["content", "values", field.id];
    const value = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    if (value === undefined || isBlankFormValue(value)) {
      if (field.required === true) {
        drafts.push({
          code: "REQUIRED_FIELD",
          fix: `Fill in ${quoteValue(field.label)} (content.values.${field.id}).`,
          message: `${quoteValue(field.label)} is required.`,
          segments,
        });
      }
      continue;
    }
    drafts.push(...checkFormValue({field, isDefault: false, segments, value}));
  }
  return drafts;
};

const fileCountText = (count: number): string => (count === 1 ? "1 file" : `${count} files`);

const fileBoundsText = ({max, min}: {max: number; min: number}): string =>
  min === max ? `exactly ${fileCountText(min)}` : `${min} to ${fileCountText(max)}`;

/**
 * The count must fit the ask, each declared type must be one `accept` allows, each file must fit
 * the per-file cap, and a data URL's media type must be the declared type. The server then checks
 * the bytes themselves with `checkAskFileBytes`.
 */
const validateFilesAnswer = (
  input: FilesAskInput,
  content: unknown,
  maxFileSizeBytes: number
): AskErrorDraft[] => {
  const parsed = filesAnswerSchema.safeParse(content);
  if (!parsed.success) {
    return issuesToAskErrors({issues: parsed.error.issues, prefix: ["content"], root: content});
  }
  const {files} = parsed.data;
  const drafts: AskErrorDraft[] = [];
  const bounds = filesCountBounds(input);
  if (files.length < bounds.min || files.length > bounds.max) {
    drafts.push({
      code: "FILE_COUNT",
      fix: `Send ${fileBoundsText(bounds)} in content.files.`,
      message: `This ask takes ${fileBoundsText(bounds)}; the answer has ${files.length}.`,
      segments: ["content", "files"],
    });
  }
  const accepted: readonly string[] = acceptedFileMimeTypes(input.accept);
  files.forEach((file, index) => {
    const segments = ["content", "files", index];
    if (!accepted.includes(file.mimeType)) {
      drafts.push({
        code: "FILE_TYPE_NOT_ACCEPTED",
        fix: `Send a file of type ${accepted.join(", ")}.`,
        message: `${quoteValue(file.filename)} is ${file.mimeType}, which this ask does not accept.`,
        segments: [...segments, "mimeType"],
      });
    }
    const dataUrl = file.url === undefined ? undefined : parseAskDataUrl(file.url);
    const size = dataUrl === undefined ? file.size : base64ByteLength(dataUrl.base64);
    if (Math.max(size, file.size) > maxFileSizeBytes) {
      drafts.push(
        fileTooLargeDraft({
          maxFileSizeBytes,
          segments: [...segments, "size"],
          size: Math.max(size, file.size),
        })
      );
    }
    if (dataUrl !== undefined && dataUrl.mediaType !== file.mimeType) {
      drafts.push({
        code: "MIME_MISMATCH",
        fix: `Make the data URL's media type ${file.mimeType}, or declare ${dataUrl.mediaType}.`,
        message: `The data URL holds ${dataUrl.mediaType}, but the file is declared as ${file.mimeType}.`,
        segments: [...segments, "url"],
      });
    }
  });
  return drafts;
};

/**
 * Checks a user's answer against the ask it answers. The client runs it before enabling Submit and
 * the server runs it before resuming the turn. Returns no errors when the answer is valid.
 * `maxFileSizeBytes` is the host's per-file cap for `files` answers (10 MB by default).
 */
export const validateAskResponse = ({
  input,
  kind,
  maxFileSizeBytes = ASK_LIMITS.files.defaultMaxFileSizeBytes,
  response,
}: {
  input: Ask["input"];
  kind: AskKind;
  maxFileSizeBytes?: number;
  response: unknown;
}): AskValidationError[] => {
  const ask = {input, kind} as Ask;
  const envelope = askResponseSchema.safeParse(response);
  if (!envelope.success) {
    return finalizeAskErrors(issuesToAskErrors({issues: envelope.error.issues, root: response}));
  }
  const answer = envelope.data;
  if (answer.action === "cancel") {
    return [];
  }
  if (answer.action === "decline") {
    if (askAllowsDecline(ask)) {
      return [];
    }
    return [
      {
        code: "DECLINE_NOT_ALLOWED",
        fix: 'Answer with action "accept".',
        message: "This ask cannot be skipped.",
        path: "action",
      },
    ];
  }
  switch (ask.kind) {
    case "choice":
      return finalizeAskErrors(validateChoiceAnswer(ask.input, answer.content));
    case "confirm":
      return finalizeAskErrors(validateConfirmAnswer(answer.content));
    case "markdown":
      return finalizeAskErrors(validateMarkdownAnswer(ask.input, answer.content));
    case "form":
      return finalizeAskErrors(validateFormAnswer(ask.input, answer.content));
    case "files":
      return finalizeAskErrors(validateFilesAnswer(ask.input, answer.content, maxFileSizeBytes));
  }
};
