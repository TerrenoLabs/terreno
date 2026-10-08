import {describe, expect, it} from "bun:test";

import {BLOCK_LIMITS} from "./limits";
import {blocksPromptSection} from "./prompt";

/**
 * The option sets the prompt took before rich blocks existed. Their snapshots were written by
 * the pre-rich-blocks prompt, so `richBlocks: false` must keep reproducing them byte for byte.
 */
const LEGACY_OPTION_SETS = {
  allowHtml: {allowHtml: true},
  everything: {
    allowHtml: true,
    hostActions: ["approve", "scaleStepper"],
    imageHosts: ["cdn.example.com"],
  },
  hostActions: {hostActions: ["exportDataset"]},
  imageHosts: {imageHosts: ["cdn.example.com"]},
  none: {},
} as const;

const STEPPER_LINE_START = "stepper requires";

describe("blocksPromptSection", () => {
  it("embeds the reply rule, the ref rule, both examples, and every limit", () => {
    const section = blocksPromptSection({
      hostActions: ["exportDataset", "scaleStepper"],
      stepperActions: ["scaleStepper"],
    });
    expect(section).toContain(
      "Your entire reply is one document; no prose outside it; no text before tool calls."
    );
    expect(section).toContain("Use the datasetId a tool returned; never paste more than 500 rows.");
    expect(section).toContain("exportDataset");
    expect(section).toContain("Show weekly signups for this quarter");
    expect(section).toContain("I could not find any signups for that range.");
    for (const [, value] of Object.entries(BLOCK_LIMITS)) {
      expect(section).toContain(String(value));
    }
  });

  it("says no callbacks are registered when the host passes none", () => {
    expect(blocksPromptSection()).toContain("No callback names are registered.");
  });

  describe("with richBlocks false", () => {
    for (const [name, options] of Object.entries(LEGACY_OPTION_SETS)) {
      it(`matches the pre-rich-blocks prompt for ${name}, even with stepper and checklist actions`, () => {
        const section = blocksPromptSection({
          ...options,
          checklistActions: ["toggleChecklist"],
          richBlocks: false,
          stepperActions: ["scaleStepper"],
        });
        expect(section).toMatchSnapshot();
        expect(section).not.toContain("stepper");
      });
    }
  });

  describe("the stepper line", () => {
    it("is on by default when the host registers a stepper action", () => {
      const section = blocksPromptSection({
        hostActions: ["scaleStepper"],
        stepperActions: ["scaleStepper"],
      });
      expect(section).toContain(STEPPER_LINE_START);
      expect(section).toBe(
        blocksPromptSection({
          hostActions: ["scaleStepper"],
          richBlocks: true,
          stepperActions: ["scaleStepper"],
        })
      );
    });

    it("never mentions stepper without a stepper action", () => {
      expect(blocksPromptSection({hostActions: ["scaleStepper"]})).not.toContain("stepper");
      expect(
        blocksPromptSection({hostActions: ["scaleStepper"], stepperActions: []})
      ).not.toContain("stepper");
    });

    it("lists stepper as a block type and names every stepper action as its callback", () => {
      const section = blocksPromptSection({
        hostActions: ["approve", "scaleStepper", "scalePortions"],
        stepperActions: ["scaleStepper", "scalePortions"],
      });
      const typesLine = section.split("\n").find((line) => line.startsWith("Block types:"));
      expect(typesLine).toContain("details, stepper.");
      expect(section).toContain(
        "A stepper callback name must be one of: scaleStepper, scalePortions."
      );
      expect(section).toContain(
        "A callback name must be one of: approve, scaleStepper, scalePortions."
      );
    });

    it("prints every stepper limit from BLOCK_LIMITS", () => {
      const withStepper = blocksPromptSection({stepperActions: ["scaleStepper"]});
      const without = blocksPromptSection();
      const added = withStepper
        .split("\n")
        .filter((line) => !without.split("\n").includes(line))
        .join("\n");
      const stepperLimits = Object.entries(BLOCK_LIMITS).filter(([key]) =>
        key.startsWith("stepper")
      );
      expect(stepperLimits.length).toBeGreaterThan(0);
      for (const [, value] of stepperLimits) {
        expect(added).toContain(String(value));
      }
    });
  });
});
