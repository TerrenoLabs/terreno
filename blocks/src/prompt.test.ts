import {describe, expect, it} from "bun:test";

import {BLOCK_LIMITS} from "./limits";
import {blocksPromptSection} from "./prompt";

describe("blocksPromptSection", () => {
  it("embeds the reply rule, the ref rule, both examples, and every limit", () => {
    const section = blocksPromptSection({hostActions: ["exportDataset"]});
    expect(section).toContain(
      "Your entire reply is one document; no prose outside it; no text before tool calls."
    );
    expect(section).toContain("Use the datasetId a tool returned; never paste more than 500 rows.");
    expect(section).toContain("exportDataset");
    expect(section).toContain("Show weekly signups for this quarter");
    expect(section).toContain("I could not find any signups for that range.");
    // Stepper limits print only when a host registers a stepper action (T2).
    const ungated = Object.entries(BLOCK_LIMITS).filter(([key]) => !key.startsWith("stepper"));
    for (const [, value] of ungated) {
      expect(section).toContain(String(value));
    }
  });

  it("says no callbacks are registered when the host passes none", () => {
    expect(blocksPromptSection()).toContain("No callback names are registered.");
  });
});
