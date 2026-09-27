import {
  type AskErrorDraft,
  type AskValidationError,
  finalizeAskErrors,
  formatAskPath,
  issuesToAskErrors,
  quoteValue,
} from "./errors";
import {
  type Ask,
  type AskKind,
  askAllowsDecline,
  askResponseSchema,
  type ChoiceAskInput,
  choiceAnswerSchema,
  choiceSelectionBounds,
  confirmAnswerSchema,
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

/**
 * Checks a user's answer against the ask it answers. The client runs it before enabling Submit and
 * the server runs it before resuming the turn. Returns no errors when the answer is valid.
 */
export const validateAskResponse = ({
  input,
  kind,
  response,
}: {
  input: Ask["input"];
  kind: AskKind;
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
  }
};
