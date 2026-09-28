import {ASK_LIMITS} from "./limits";
import {type AskKind, type AskSurface, type CompactAskKind, isCompactAskKind} from "./schema";

const CHOICE_ANSWER_EXAMPLE =
  '- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.';

const CHOICE_DECLINE_RULE =
  "- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.";

const CHOICE_ID_RULE = `- id: 1-${ASK_LIMITS.choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.`;

const sharedRules = (): string =>
  [
    "Rules for every ask:",
    `- prompt: required. Plain text with no markdown and no links, 1-${ASK_LIMITS.promptMaxLength} characters.`,
    `- title: optional, at most ${ASK_LIMITS.titleMaxLength} characters.`,
    "- Each ask kind below lists its other fields, including whether the user can skip it.",
  ].join("\n");

const compactSharedRules = (): string =>
  [
    sharedRules(),
    `- The screen is small: it shows only the first ${ASK_LIMITS.simpleCard.textMaxLength} characters of prompt and the first ${ASK_LIMITS.simpleCard.titleMaxLength} characters of title, so keep both within those lengths.`,
  ].join("\n");

const choiceRules = (): string => {
  const {choice, simpleCard} = ASK_LIMITS;
  return [
    "ask_choice: the user picks one or more options from a list you provide.",
    '- select: "one" for exactly one option, or "many" to let the user pick several.',
    `- options: ${choice.optionsMin}-${choice.optionsMax} items, each {id, label, description?}.`,
    CHOICE_ID_RULE,
    `- label: at most ${choice.optionLabelMaxLength} characters. description: optional, at most ${choice.optionDescriptionMaxLength} characters.`,
    '- default: optional list of option ids to preselect, each listed once. With "one", at most one id; with "many", at most maxSelected ids.',
    '- minSelected, maxSelected: optional whole numbers, "many" only. The user picks from minSelected (default 1, at least 0) to maxSelected (default: every choice) choices.',
    `- allowOther: optional, "many" only. true adds a text field where the user types an answer of their own, up to ${choice.otherMaxLength} characters. It counts as one choice. otherLabel: optional label for that field, at most ${choice.optionLabelMaxLength} characters. For one option or Other, use "many" with maxSelected 1.`,
    `- submitLabel: optional label for the submit button, at most ${ASK_LIMITS.submitLabelMaxLength} characters.`,
    CHOICE_DECLINE_RULE,
    `- Prefer select "one" with at most ${simpleCard.buttonsMax} options with labels of ${simpleCard.buttonLabelMaxLength} characters or fewer; small screens show those as buttons.`,
    CHOICE_ANSWER_EXAMPLE,
    '- With Other, it looks like {"action": "accept", "content": {"selected": ["<id>"], "other": "<text the user typed>"}}.',
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
    CHOICE_DECLINE_RULE,
    CHOICE_ANSWER_EXAMPLE,
  ].join("\n");
};

/** A confirm always fits a simple card, so the full and compact surfaces share these rules. */
const confirmRules = (): string => {
  const {labelMaxLength} = ASK_LIMITS.confirm;
  return [
    "ask_confirm: the user approves or denies one action you describe in prompt.",
    `- confirmLabel, denyLabel: optional labels for the approve and deny buttons, at most ${labelMaxLength} characters each, counting each emoji as 2 or more, and different from each other. They default to "Confirm" and "Cancel". Name the action, such as "Delete 14 todos" and "Keep them".`,
    "- destructive: optional, default false. Set it to true when the action deletes data or cannot be undone; the approve button then shows as destructive.",
    "- allowDecline: optional, default false, because the deny button is the negative answer. Set it to true to show Skip as well.",
    `- Before you call a tool that deletes data, sends something on the user's behalf, spends money, or cannot be undone, call ask_confirm and say in prompt exactly what will happen. Make the call only after {"confirmed": true}.`,
    '- An accepted answer looks like {"action": "accept", "content": {"confirmed": true}}. {"confirmed": false} means the user said no, so do not take the action.',
  ].join("\n");
};

const markdownRules = (): string => {
  const {markdown} = ASK_LIMITS;
  return [
    "ask_markdown: the user edits a markdown draft you write and sends it back.",
    `- initial: optional, the draft in markdown, at most ${markdown.maxLength} characters. Put the whole draft here, not in prompt.`,
    `- minLength, maxLength: optional whole numbers. The answer must have at least minLength (default 0) and at most maxLength (default ${markdown.maxLength}, the most allowed) characters. minLength must not be more than maxLength.`,
    `- placeholder: optional hint shown while the editor is empty, at most ${markdown.placeholderMaxLength} characters.`,
    `- submitLabel: optional label for the submit button, at most ${ASK_LIMITS.submitLabelMaxLength} characters.`,
    "- allowDecline: optional, default true (the user sees Skip).",
    '- An accepted answer looks like {"action": "accept", "content": {"markdown": "<the text>", "changed": true}}. changed is false when the user sent your draft unchanged.',
  ].join("\n");
};

const formRules = (): string => {
  const {choice, form} = ASK_LIMITS;
  return [
    "ask_form: the user fills in a few fields and submits them at once.",
    `- fields: ${form.fieldsMin}-${form.fieldsMax} items, in display order, each {id, type, label, helperText?, required?, default?} plus the rules of its type. Fields are flat: no nesting, no conditional fields, and no password fields.`,
    `- id: 1-${choice.optionIdMaxLength} lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the form. It keys the field's value in the answer.`,
    `- label: at most ${form.labelMaxLength} characters. helperText: optional, at most ${form.helperTextMaxLength} characters. required: optional, default false; true means the answer must hold a non-blank value.`,
    `- type "text" (one line) or "textarea" (several lines): optional minLength and maxLength. maxLength is at most ${form.textMaxLength} for text and ${form.textareaMaxLength} for textarea. The value is a string.`,
    `- type "email", "url" (http or https), or "phone" (${form.phoneDigitsMin}-${form.phoneDigitsMax} digits): the value is a string in that format.`,
    '- type "number": optional min, max, and integer (true for whole numbers only). The value is a number.',
    '- type "date" (YYYY-MM-DD), "time" (24-hour HH:mm), or "datetime" (ISO 8601 with Z or an offset; seconds are optional, such as "2026-10-01T09:30Z" or "2026-10-01T09:30:00+02:00"): the value is a string in that format.',
    '- type "boolean": a checkbox. The value is true or false.',
    `- type "select" (pick one) or "multiselect" (pick any): options, ${choice.optionsMin}-${choice.optionsMax} items, each {id, label}. The value is an option id, or a list of option ids.`,
    "- default: optional, a value the field accepts, filled in when the form opens.",
    `- submitLabel: optional label for the submit button, at most ${ASK_LIMITS.submitLabelMaxLength} characters.`,
    "- allowDecline: optional, default true (the user sees Skip).",
    '- An accepted answer looks like {"action": "accept", "content": {"values": {"<field id>": <value>}}}. Optional fields the user left empty are left out.',
  ].join("\n");
};

const KIND_RULES: Record<AskKind, () => string> = {
  choice: choiceRules,
  confirm: confirmRules,
  form: formRules,
  markdown: markdownRules,
};

const COMPACT_KIND_RULES: Record<CompactAskKind, () => string> = {
  choice: compactChoiceRules,
  confirm: confirmRules,
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
