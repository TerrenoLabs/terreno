import {describe, expect, it} from "bun:test";
import {blocksPromptSection} from "@terreno/blocks";

import {
  askFileHeading,
  CONTENT_SUMMARY_PROMPT,
  DEFAULT_GPT_MEMORY,
  JSON_VALUE_SYSTEM_PROMPT,
  REMIX_PROMPT,
  TERRENO_UI_BLOCKS_SYSTEM_PROMPT,
  TITLE_GENERATION_PROMPT,
  TRANSLATION_PROMPT,
  truncatedAskFileNote,
  uiBlocksSystemPrompt,
  unloadedAskUploadsNote,
} from "./prompts";

describe("AI prompt constants", () => {
  it("exports non-empty system and helper prompts", () => {
    expect(DEFAULT_GPT_MEMORY.length).toBeGreaterThan(20);
    expect(REMIX_PROMPT).toContain("Reword");
    expect(CONTENT_SUMMARY_PROMPT).toContain("two-paragraph");
    expect(TRANSLATION_PROMPT).toContain("{sourceLanguage}");
    expect(TRANSLATION_PROMPT).toContain("{targetLanguage}");
    expect(TITLE_GENERATION_PROMPT).toContain("3-6 words");
    expect(JSON_VALUE_SYSTEM_PROMPT).toContain("JSON value");
  });

  it("words the lines around a files answer's files as the model reads them", () => {
    expect(
      askFileHeading({
        count: 2,
        filename: "day.csv",
        mimeType: "text/csv",
        position: 1,
        size: 28,
      })
    ).toBe("File 1 of 2: day.csv (text/csv, 28 bytes)");
    expect(truncatedAskFileNote({keptBytes: 102400, totalBytes: 150000})).toBe(
      "[The file is cut to its first 102400 of 150000 bytes.]"
    );
    expect(unloadedAskUploadsNote([{fileId: "f1", filename: "a.png"}])).toBe(
      'Uploads not loaded here: [{"fileId":"f1","filename":"a.png"}]'
    );
  });

  it("honours the rich-block opt-out when nothing else is configured", () => {
    expect(uiBlocksSystemPrompt({hostActions: [], richBlocks: false})).toBe(
      blocksPromptSection({richBlocks: false})
    );
    expect(uiBlocksSystemPrompt({hostActions: []})).toBe(TERRENO_UI_BLOCKS_SYSTEM_PROMPT);
    expect(TERRENO_UI_BLOCKS_SYSTEM_PROMPT).toContain("checklist requires");
    expect(uiBlocksSystemPrompt({hostActions: [], richBlocks: false})).not.toContain("checklist");
  });

  it("names the checklist action in the prompt when the host registers one", () => {
    const section = uiBlocksSystemPrompt({
      checklistActions: ["toggleChecklist"],
      hostActions: ["toggleChecklist"],
    });
    expect(section).toContain("Set a checklist callback name to one of: toggleChecklist.");
    expect(uiBlocksSystemPrompt({hostActions: []})).toContain("Leave callback out of a checklist");
  });
});
