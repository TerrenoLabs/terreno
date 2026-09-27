import {ASK_LIMITS} from "./limits";
import {type AskKind, type AskSurface, type CompactAskKind, isCompactAskKind} from "./schema";

const CHOICE_ANSWER_EXAMPLE =
  '- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.';

const CHOICE_ID_RULE = `- id: 1-${ASK_LIMITS.choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.`;

const sharedRules = (): string =>
  [
    "Rules for every ask:",
    `- prompt: required. Plain text with no markdown and no links, 1-${ASK_LIMITS.promptMaxLength} characters.`,
    `- title: optional, at most ${ASK_LIMITS.titleMaxLength} characters.`,
    `- submitLabel: optional, at most ${ASK_LIMITS.submitLabelMaxLength} characters.`,
    "- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.",
  ].join("\n");

const compactSharedRules = (): string =>
  [
    sharedRules(),
    `- The screen is small: it shows only the first ${ASK_LIMITS.simpleCard.textMaxLength} characters of prompt and the first ${ASK_LIMITS.simpleCard.titleMaxLength} characters of title, so keep both within those lengths.`,
  ].join("\n");

const choiceRules = (): string => {
  const {choice, simpleCard} = ASK_LIMITS;
  return [
    "ask_choice: the user picks one option from a list you provide.",
    '- select: always "one".',
    `- options: ${choice.optionsMin}-${choice.optionsMax} items, each {id, label, description?}.`,
    CHOICE_ID_RULE,
    `- label: at most ${choice.optionLabelMaxLength} characters. description: optional, at most ${choice.optionDescriptionMaxLength} characters.`,
    "- default: optional list with at most one option id to preselect.",
    `- Prefer at most ${simpleCard.buttonsMax} options with labels of ${simpleCard.buttonLabelMaxLength} characters or fewer; small screens show those as buttons.`,
    CHOICE_ANSWER_EXAMPLE,
  ].join("\n");
};

const compactChoiceRules = (): string => {
  const {choice, simpleCard} = ASK_LIMITS;
  return [
    "ask_choice: the user picks one option by tapping its button.",
    '- select: always "one".',
    `- options: ${choice.optionsMin}-${simpleCard.buttonsMax} items, each {id, label, description?}.`,
    CHOICE_ID_RULE,
    `- label: at most ${simpleCard.buttonLabelMaxLength} characters, counting each emoji as 2 or more, and no two options share a label.`,
    `- description: optional, at most ${choice.optionDescriptionMaxLength} characters. The buttons show only labels, so put what the user needs to decide in prompt and the labels.`,
    "- default: optional list with at most one option id to preselect.",
    CHOICE_ANSWER_EXAMPLE,
  ].join("\n");
};

const KIND_RULES: Record<AskKind, () => string> = {
  choice: choiceRules,
};

const COMPACT_KIND_RULES: Record<CompactAskKind, () => string> = {
  choice: compactChoiceRules,
};

const formatSection = ({
  kindRules,
  kinds,
  shared,
}: {
  kindRules: string[];
  kinds: readonly AskKind[];
  shared: string;
}): string => {
  if (kinds.length === 0) {
    return "";
  }
  const toolNames = kinds.map((kind) => `ask_${kind}`).join(", ");
  return [`Ask tools you can call: ${toolNames}.`, shared, ...kindRules].join("\n\n");
};

/**
 * The system prompt section that describes the enabled ask kinds and their limits. Every number
 * comes from `ASK_LIMITS`. With `surface: "compact"`, it lists only the kinds the compact surface
 * offers, with their narrowed limits. Returns an empty string when no kinds are offered.
 */
export const askPromptSection = ({
  kinds,
  surface = "full",
}: {
  kinds: readonly AskKind[];
  surface?: AskSurface;
}): string => {
  const uniqueKinds = [...new Set(kinds)];
  if (surface === "compact") {
    const compactKinds = uniqueKinds.filter(isCompactAskKind);
    return formatSection({
      kindRules: compactKinds.map((kind) => COMPACT_KIND_RULES[kind]()),
      kinds: compactKinds,
      shared: compactSharedRules(),
    });
  }
  return formatSection({
    kindRules: uniqueKinds.map((kind) => KIND_RULES[kind]()),
    kinds: uniqueKinds,
    shared: sharedRules(),
  });
};
