import {
  type AskErrorDraft,
  type AskValidationError,
  finalizeAskErrors,
  issuesToAskErrors,
  quoteValue,
} from "./errors";
import {type Ask, askResponseSchema, type ChoiceAskInput, choiceAnswerSchema} from "./schema";

const validateChoiceAnswer = (input: ChoiceAskInput, content: unknown): AskErrorDraft[] => {
  const parsed = choiceAnswerSchema.safeParse(content);
  if (!parsed.success) {
    return issuesToAskErrors({issues: parsed.error.issues, prefix: ["content"], root: content});
  }
  const {selected} = parsed.data;
  const drafts: AskErrorDraft[] = [];
  if (selected.length !== 1) {
    drafts.push({
      code: "SELECTION_COUNT",
      fix: "Send exactly one option id in content.selected.",
      message: `Choose exactly one option; the answer selects ${selected.length}.`,
      segments: ["content", "selected"],
    });
  }
  const offeredIds = new Set(input.options.map((option) => option.id));
  selected.forEach((id, index) => {
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

/**
 * Checks a user's answer against the ask it answers. The client runs it before enabling Submit and
 * the server runs it before resuming the turn. Returns no errors when the answer is valid.
 */
export const validateAskResponse = ({
  input,
  kind,
  response,
}: Ask & {response: unknown}): AskValidationError[] => {
  const envelope = askResponseSchema.safeParse(response);
  if (!envelope.success) {
    return finalizeAskErrors(issuesToAskErrors({issues: envelope.error.issues, root: response}));
  }
  const answer = envelope.data;
  if (answer.action === "cancel") {
    return [];
  }
  if (answer.action === "decline") {
    if (input.allowDecline !== false) {
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
  switch (kind) {
    case "choice":
      return finalizeAskErrors(validateChoiceAnswer(input, answer.content));
  }
};
