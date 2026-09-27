import {describe, expect, it} from "bun:test";
import {askPromptSection} from "./prompt";

const CHOICE_SECTION = `Ask tools you can call: ask_choice.

Rules for every ask:
- prompt: required. Plain text with no markdown and no links, 1-500 characters.
- title: optional, at most 80 characters.
- submitLabel: optional, at most 24 characters.
- allowDecline: optional, default true (the user sees Skip). Set it to false only when you cannot continue without an answer.

ask_choice: the user picks one option from a list you provide.
- select: always "one".
- options: 2-50 items, each {id, label, description?}.
- id: 1-64 lowercase letters, digits, "_", or "-", starting with a letter or digit. Unique within the ask.
- label: at most 120 characters. description: optional, at most 280 characters.
- default: optional list with at most one option id to preselect.
- Prefer at most 3 options with labels of 20 characters or fewer; small screens show those as buttons.
- An accepted answer looks like {"action": "accept", "content": {"selected": ["<id>"]}}.`;

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
});
