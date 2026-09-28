import {
  ASK_CANCEL_REASONS,
  type ChoiceAskInput,
  type ConfirmAskInput,
  confirmButtonLabels,
} from "@terreno/blocks";

import type {ChatAsk} from "./askTypes";

const ANSWERED = "You answered this question.";

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** A whole number with thousands separators, such as "1,240". */
export const formatCount = (count: number): string => String(count).replace(THOUSANDS, ",");
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

/** "You confirmed: <approve label>" or "You declined: <deny label>" for an accepted `confirm` answer. */
const confirmSummary = (input: ConfirmAskInput, content: Record<string, unknown>): string => {
  const labels = confirmButtonLabels(input);
  if (content.confirmed === true) {
    return `You confirmed: ${labels.confirm}`;
  }
  if (content.confirmed === false) {
    return `You declined: ${labels.deny}`;
  }
  return ANSWERED;
};

/** "You edited the draft (1,240 characters)" or "You approved the draft as is" for a `markdown` answer. */
const markdownSummary = (content: Record<string, unknown>): string => {
  if (typeof content.markdown !== "string") {
    return ANSWERED;
  }
  if (content.changed === false) {
    return "You approved the draft as is";
  }
  const {length} = content.markdown;
  return `You edited the draft (${formatCount(length)} ${length === 1 ? "character" : "characters"})`;
};

/** "You sent the form (5 fields)" for a `form` answer, counting the fields it filled in. */
const formSummary = (content: Record<string, unknown>): string => {
  const {values} = content;
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return ANSWERED;
  }
  const count = Object.keys(values).length;
  return `You sent the form (${formatCount(count)} ${count === 1 ? "field" : "fields"})`;
};

/** "You sent 2 files: receipt.png, items.txt" for a `files` answer. */
const filesSummary = (content: Record<string, unknown>): string => {
  const {files} = content;
  if (!Array.isArray(files)) {
    return ANSWERED;
  }
  const names = files.map((file) => String((file as {filename?: unknown}).filename ?? "file"));
  const count = `${formatCount(names.length)} ${names.length === 1 ? "file" : "files"}`;
  return names.length > 0 ? `You sent ${count}: ${names.join(", ")}` : `You sent ${count}`;
};

const acceptedSummary = (ask: ChatAsk, content: Record<string, unknown>): string => {
  switch (ask.kind) {
    case "choice":
      return choiceSummary(ask.input, content);
    case "confirm":
      return confirmSummary(ask.input, content);
    case "markdown":
      return markdownSummary(content);
    case "form":
      return formSummary(content);
    case "files":
      return filesSummary(content);
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
