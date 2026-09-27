import {describe, expect, it} from "bun:test";
import {askPromptSection} from "./prompt";

const CHOICE_SECTION = `Ask tools you can call: ask_choice.

Rules for every ask:
- prompt: required. Plain text with no markdown and no links, 1-500 characters.
- title: optional, at most 80 characters.
- Each ask kind below lists its other fields, including whether the user can skip it.

ask_choice: the user picks one or more options from a list you provide.
- select: "one" for exactly one option, or "many" to let the user pick several.
- options: 2-50 items, each {id, label, description?}.
- id: 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.
- label: at most 120 characters. description: optional, at most 280 characters.
- default: optional list of option ids to preselect, each listed once. With "one", at most one id; with "many", at most maxSelected ids.
- minSelected, maxSelected: optional whole numbers, "many" only. The user picks from minSelected (default 1, at least 0) to maxSelected (default: every choice) choices.
- allowOther: optional, "many" only. true adds a text field where the user types an answer of their own, up to 500 characters. It counts as one choice. otherLabel: optional label for that field, at most 120 characters. For one option or Other, use "many" with maxSelected 1.
- submitLabel: optional label for the submit button, at most 24 characters.
- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.
- Prefer select "one" with at most 3 options with labels of 20 characters or fewer; small screens show those as buttons.
- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.
- With Other, it looks like {"action": "accept", "content": {"selected": ["<id>"], "other": "<text the user typed>"}}.`;

const COMPACT_CHOICE_SECTION = `Ask tools you can call: ask_choice.

Rules for every ask:
- prompt: required. Plain text with no markdown and no links, 1-500 characters.
- title: optional, at most 80 characters.
- Each ask kind below lists its other fields, including whether the user can skip it.
- The screen is small: it shows only the first 140 characters of prompt and the first 40 characters of title, so keep both within those lengths.

ask_choice: the user picks one option by tapping its button.
- select: always "one".
- options: 2-3 items, each {id, label, description?}.
- id: 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.
- label: at most 20 characters, counting each emoji as 2 or more, and no two options share a label.
- description: optional, at most 280 characters. The buttons show only labels, so put what the user needs to decide in prompt and the labels.
- default: optional list with at most one option id to preselect.
- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.
- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.`;

const CONFIRM_RULES = `ask_confirm: the user approves or denies one action you describe in prompt.
- confirmLabel, denyLabel: optional labels for the approve and deny buttons, at most 20 characters each, counting each emoji as 2 or more, and different from each other. They default to "Confirm" and "Cancel". Name the action, such as "Delete 14 todos" and "Keep them".
- destructive: optional, default false. Set it to true when the action deletes data or cannot be undone; the approve button then shows as destructive.
- allowDecline: optional, default false, because the deny button is the negative answer. Set it to true to show Skip as well.
- Before you call a tool that deletes data, sends something on the user's behalf, spends money, or cannot be undone, call ask_confirm and say in prompt exactly what will happen. Make the call only after {"confirmed": true}.
- An accepted answer looks like {"action": "accept", "content": {"confirmed": true}}. {"confirmed": false} means the user said no, so do not take the action.`;

const sectionOf = (section: string, kindRules: string[]): string =>
  [section.replace("ask_choice.", "ask_choice, ask_confirm."), ...kindRules].join("\n\n");

describe("askPromptSection", () => {
  it("describes ask_choice with the limits from ASK_LIMITS", () => {
    expect(askPromptSection({kinds: ["choice"]})).toBe(CHOICE_SECTION);
  });

  it("lists each kind once when a kind repeats", () => {
    expect(askPromptSection({kinds: ["choice", "choice"]})).toBe(CHOICE_SECTION);
  });

  it("returns an empty string when no kinds are enabled", () => {
    expect(askPromptSection({kinds: []})).toBe("");
  });

  it("describes the full surface by default", () => {
    expect(askPromptSection({kinds: ["choice"], surface: "full"})).toBe(CHOICE_SECTION);
  });

  it("describes ask_confirm after ask_choice, with the button label limit", () => {
    expect(askPromptSection({kinds: ["choice", "confirm"]})).toBe(
      sectionOf(CHOICE_SECTION, [CONFIRM_RULES])
    );
  });

  it("describes ask_confirm alone, with the shared rules", () => {
    const section = askPromptSection({kinds: ["confirm"]});
    expect(section.startsWith("Ask tools you can call: ask_confirm.\n\nRules for every ask:")).toBe(
      true
    );
    expect(section.endsWith(`\n\n${CONFIRM_RULES}`)).toBe(true);
    expect(section).not.toContain("ask_choice");
  });

  it("leaves submitLabel and the Skip default out of the shared rules, since confirm differs", () => {
    const section = askPromptSection({kinds: ["confirm"]});
    expect(section).not.toContain("submitLabel");
    expect(section).not.toContain("default true");
    expect(section).toContain("- allowDecline: optional, default false");
  });
});

describe("askPromptSection on the compact surface", () => {
  it("describes ask_choice with the simple card limits from ASK_LIMITS", () => {
    expect(askPromptSection({kinds: ["choice"], surface: "compact"})).toBe(COMPACT_CHOICE_SECTION);
  });

  it("lists each kind once when a kind repeats", () => {
    expect(askPromptSection({kinds: ["choice", "choice"], surface: "compact"})).toBe(
      COMPACT_CHOICE_SECTION
    );
  });

  it("returns an empty string when no kinds are enabled", () => {
    expect(askPromptSection({kinds: [], surface: "compact"})).toBe("");
  });

  it("offers ask_confirm with the same rules, because it always fits a simple card", () => {
    expect(askPromptSection({kinds: ["choice", "confirm"], surface: "compact"})).toBe(
      sectionOf(COMPACT_CHOICE_SECTION, [CONFIRM_RULES])
    );
  });
});
