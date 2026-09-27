import {ASK_CANCEL_REASONS, type ChoiceAskInput} from "@terreno/blocks";

import type {ChatAsk} from "./askTypes";

const ANSWERED = "You answered this question.";
const CANCELLED = "This question was cancelled.";

const choiceLabels = (input: ChoiceAskInput, content: Record<string, unknown>): string => {
  const {selected} = content;
  if (!Array.isArray(selected)) {
    return "";
  }
  return selected
    .map((id) => input.options.find((option) => option.id === id)?.label ?? String(id))
    .join(", ");
};

/**
 * "You chose: A, B", "Other: text", or both, for an accepted `choice` answer. The Other part uses
 * the ask's `otherLabel` when it sets one.
 */
const choiceSummary = (input: ChoiceAskInput, content: Record<string, unknown>): string => {
  const labels = choiceLabels(input, content);
  const other = typeof content.other === "string" ? content.other : "";
  const otherLabel = input.otherLabel ?? "Other";
  const parts = [
    labels ? `You chose: ${labels}` : "",
    other ? `${otherLabel}: ${other}` : "",
  ].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(". ");
  }
  return Array.isArray(content.selected) ? "You chose none of the options." : ANSWERED;
};

const acceptedSummary = (ask: ChatAsk, content: Record<string, unknown>): string => {
  switch (ask.kind) {
    case "choice":
      return choiceSummary(ask.input, content);
  }
};

const cancelledSummary = (reason: string | undefined): string => {
  if (reason === ASK_CANCEL_REASONS.userSentMessage) {
    return "Not answered: you sent a message instead.";
  }
  if (reason === ASK_CANCEL_REASONS.oneAskAtATime) {
    return "Not asked: the assistant asked another question first.";
  }
  return CANCELLED;
};

/** One line that says how an ask ended, such as "You chose: Team". */
export const askSummary = (ask: ChatAsk): string => {
  const {response, status} = ask;
  if (response?.action === "accept") {
    return acceptedSummary(ask, response.content);
  }
  if (response?.action === "decline") {
    return "You skipped this question.";
  }
  if (response?.action === "cancel") {
    return cancelledSummary(response.reason);
  }
  if (status === "answered") {
    return ANSWERED;
  }
  if (status === "cancelled") {
    return CANCELLED;
  }
  return "Waiting for your answer.";
};
