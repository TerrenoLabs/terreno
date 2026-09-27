import {ASK_LIMITS} from "./limits";
import type {AskKind} from "./schema";

const sharedRules = (): string =>
  [
    "Rules for every ask:",
    `- prompt: required. Plain text with no markdown and no links, 1-${ASK_LIMITS.promptMaxLength} characters.`,
    `- title: optional, at most ${ASK_LIMITS.titleMaxLength} characters.`,
    `- submitLabel: optional, at most ${ASK_LIMITS.submitLabelMaxLength} characters.`,
    "- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.",
  ].join("\n");

const choiceRules = (): string => {
  const {choice, simpleCard} = ASK_LIMITS;
  return [
    "ask_choice: the user picks one option from a list you provide.",
    '- select: always "one".',
    `- options: ${choice.optionsMin}-${choice.optionsMax} items, each {id, label, description?}.`,
    `- id: 1-${choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.`,
    `- label: at most ${choice.optionLabelMaxLength} characters. description: optional, at most ${choice.optionDescriptionMaxLength} characters.`,
    "- default: optional list with at most one option id to preselect.",
    `- Prefer at most ${simpleCard.buttonsMax} options with labels of ${simpleCard.buttonLabelMaxLength} characters or fewer; small screens show those as buttons.`,
    '- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.',
  ].join("\n");
};

const KIND_RULES: Record<AskKind, () => string> = {
  choice: choiceRules,
};

/**
 * The system prompt section that describes the enabled ask kinds and their limits. Every number
 * comes from `ASK_LIMITS`. Returns an empty string when no kinds are enabled.
 */
export const askPromptSection = ({kinds}: {kinds: readonly AskKind[]}): string => {
  const uniqueKinds = [...new Set(kinds)];
  if (uniqueKinds.length === 0) {
    return "";
  }
  const toolNames = uniqueKinds.map((kind) => `ask_${kind}`).join(", ");
  return [
    `Ask tools you can call: ${toolNames}.`,
    sharedRules(),
    ...uniqueKinds.map((kind) => KIND_RULES[kind]()),
  ].join("\n\n");
};
