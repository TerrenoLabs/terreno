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

const MARKDOWN_RULES = `ask_markdown: the user edits a markdown draft you write and sends it back.
- initial: optional, the draft in markdown, at most 20000 characters. Put the whole draft here, not in prompt.
- minLength, maxLength: optional whole numbers. The answer must have at least minLength (default 0) and at most maxLength (default 20000, the most allowed) characters. minLength must not be more than maxLength.
- placeholder: optional hint shown while the editor is empty, at most 120 characters.
- submitLabel: optional label for the submit button, at most 24 characters.
- allowDecline: optional, default true (the user sees Skip).
- An accepted answer looks like {"action": "accept", "content": {"markdown": "<the text>", "changed": true}}. changed is false when the user sent your draft unchanged.`;

const FORM_RULES = `ask_form: the user fills in a few fields and submits them at once.
- fields: 1-8 items, in display order, each {id, type, label, helperText?, required?, default?} plus the rules of its type. Fields are flat: no nesting, no conditional fields, and no password fields.
- id: 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the form. It keys the field's value in the answer.
- label: at most 120 characters. helperText: optional, at most 280 characters. required: optional, default false; true means the answer must hold a non-blank value.
- type "text" (one line) or "textarea" (several lines): optional minLength and maxLength. maxLength is at most 2000 for text and 10000 for textarea. The value is a string.
- type "email", "url" (http or https), or "phone" (7-15 digits): the value is a string in that format.
- type "number": optional min, max, and integer (true for whole numbers only). The value is a number.
- type "date" (YYYY-MM-DD), "time" (24-hour HH:mm), or "datetime" (ISO 8601 with Z or an offset; seconds are optional, such as "2026-10-01T09:30Z" or "2026-10-01T09:30:00+02:00"): the value is a string in that format.
- type "boolean": a checkbox. The value is true or false.
- type "select" (pick one) or "multiselect" (pick any): options, 2-50 items, each {id, label}. The value is an option id, or a list of option ids.
- default: optional, a value the field accepts, filled in when the form opens.
- submitLabel: optional label for the submit button, at most 24 characters.
- allowDecline: optional, default true (the user sees Skip).
- An accepted answer looks like {"action": "accept", "content": {"values": {"<field id>": <value>}}}. Optional fields the user left empty are left out.`;

const FILES_RULES = `ask_files: the user uploads one or more images or documents.
- accept: required list, each value once: "image" (JPEG, PNG, GIF, or WebP), "pdf", "text" (plain text), "csv", or "json".
- minFiles, maxFiles: optional whole numbers from 1 to 10. The user sends from minFiles (default 1) to maxFiles (default 10) files.
- submitLabel: optional label for the submit button, at most 24 characters.
- allowDecline: optional, default true (the user sees Skip).
- The answer lists each file's filename, mimeType, and size, and the tool result then shows you each file: images and PDFs as they are, and text, CSV, and JSON as text cut to 100000 bytes.`;

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

  it("describes ask_markdown after ask_confirm, with the length limits from ASK_LIMITS", () => {
    expect(askPromptSection({kinds: ["choice", "confirm", "markdown"]})).toBe(
      [
        CHOICE_SECTION.replace("ask_choice.", "ask_choice, ask_confirm, ask_markdown."),
        CONFIRM_RULES,
        MARKDOWN_RULES,
      ].join("\n\n")
    );
  });

  it("describes ask_form after ask_markdown, with the field limits from ASK_LIMITS", () => {
    expect(askPromptSection({kinds: ["choice", "confirm", "markdown", "form"]})).toBe(
      [
        CHOICE_SECTION.replace("ask_choice.", "ask_choice, ask_confirm, ask_markdown, ask_form."),
        CONFIRM_RULES,
        MARKDOWN_RULES,
        FORM_RULES,
      ].join("\n\n")
    );
  });

  it("describes ask_files after ask_form, with the file limits from ASK_LIMITS", () => {
    expect(askPromptSection({kinds: ["choice", "confirm", "markdown", "form", "files"]})).toBe(
      [
        CHOICE_SECTION.replace(
          "ask_choice.",
          "ask_choice, ask_confirm, ask_markdown, ask_form, ask_files."
        ),
        CONFIRM_RULES,
        MARKDOWN_RULES,
        FORM_RULES,
        FILES_RULES,
      ].join("\n\n")
    );
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

  it("leaves ask_markdown out, because a draft cannot be edited on a small screen", () => {
    expect(askPromptSection({kinds: ["choice", "confirm", "markdown"], surface: "compact"})).toBe(
      sectionOf(COMPACT_CHOICE_SECTION, [CONFIRM_RULES])
    );
    expect(askPromptSection({kinds: ["markdown"], surface: "compact"})).toBe("");
  });

  it("leaves ask_form out, because fields cannot be filled in on a small screen", () => {
    expect(askPromptSection({kinds: ["choice", "confirm", "form"], surface: "compact"})).toBe(
      sectionOf(COMPACT_CHOICE_SECTION, [CONFIRM_RULES])
    );
    expect(askPromptSection({kinds: ["form"], surface: "compact"})).toBe("");
  });

  it("leaves ask_files out, because files cannot be picked on a small screen", () => {
    expect(askPromptSection({kinds: ["choice", "confirm", "files"], surface: "compact"})).toBe(
      sectionOf(COMPACT_CHOICE_SECTION, [CONFIRM_RULES])
    );
    expect(askPromptSection({kinds: ["files"], surface: "compact"})).toBe("");
  });
});
