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
const CHECKLIST_LINE_START = "checklist requires";
const GALLERY_LINE_START = "gallery requires";
const LIST_LINE_START = "list requires";
const COPY_LINE_START = "action.kind may also be copy";

/** Every option that changes the rich prompt, so the full on-case snapshot catches any drift. */
const FULL_RICH_OPTIONS = {
  checklistActions: ["toggleChecklist"],
  hostActions: ["approve", "scaleStepper", "toggleChecklist"],
  imageHosts: ["images.example.com"],
  stepperActions: ["scaleStepper"],
} as const;
/** Matches the list block by word, so checklist lines do not count. */
const LIST_WORD = /\blist\b/;

const linesAdded = (section: string, base: string): string[] => {
  const baseLines = new Set(base.split("\n"));
  return section.split("\n").filter((line) => !baseLines.has(line));
};

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
        expect(section).not.toContain("checklist");
        expect(section).not.toContain("gallery");
        expect(section).not.toMatch(LIST_WORD);
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
      expect(typesLine).toContain(", stepper");
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

  describe("the checklist line", () => {
    it("is on by default and lists checklist as a block type", () => {
      const section = blocksPromptSection();
      expect(section).toContain(CHECKLIST_LINE_START);
      expect(section).toBe(blocksPromptSection({richBlocks: true}));
      const typesLine = section.split("\n").find((line) => line.startsWith("Block types:"));
      expect(typesLine).toContain(", checklist");
      const allowHtmlTypes = blocksPromptSection({allowHtml: true})
        .split("\n")
        .find((line) => line.startsWith("Block types:"));
      expect(allowHtmlTypes).toContain(", checklist");
    });

    it("tells the model to leave callback out when no checklist action is registered", () => {
      const section = blocksPromptSection({hostActions: ["toggleChecklist"]});
      const added = linesAdded(
        section,
        blocksPromptSection({hostActions: ["toggleChecklist"], richBlocks: false})
      );
      const callbackLine = added.find(
        (line) => line.includes("checklist") && line.includes("callback")
      );
      expect(callbackLine).toContain("Leave callback out of a checklist");
      expect(added.join("\n")).not.toContain("toggleChecklist");
      expect(blocksPromptSection({checklistActions: []})).toBe(blocksPromptSection());
    });

    it("names every checklist action as the callback to set when the host registers them", () => {
      const section = blocksPromptSection({
        checklistActions: ["toggleChecklist", "recordProgress"],
        hostActions: ["approve", "toggleChecklist", "recordProgress"],
      });
      expect(section).toContain(
        "Set a checklist callback name to one of: toggleChecklist, recordProgress."
      );
      expect(section).not.toContain("Leave callback out of a checklist");
      expect(section).not.toContain("stepper");
    });

    it("prints every checklist limit from BLOCK_LIMITS in the lines it adds", () => {
      const added = linesAdded(
        blocksPromptSection(),
        blocksPromptSection({richBlocks: false})
      ).join("\n");
      const checklistLimits = Object.entries(BLOCK_LIMITS).filter(([key]) =>
        key.startsWith("checklist")
      );
      expect(checklistLimits.length).toBeGreaterThan(0);
      for (const [, value] of checklistLimits) {
        expect(added).toContain(String(value));
      }
    });
  });

  describe("the gallery line", () => {
    it("is on by default and lists gallery as a block type", () => {
      const section = blocksPromptSection();
      expect(section).toContain(GALLERY_LINE_START);
      for (const allowHtml of [false, true]) {
        const typesLine = blocksPromptSection({allowHtml})
          .split("\n")
          .find((line) => line.startsWith("Block types:"));
        expect(typesLine).toContain(", gallery");
      }
    });

    it("sends gallery srcs to the image rules and keeps the https rule tied to imageHosts", () => {
      const withoutHosts = linesAdded(
        blocksPromptSection(),
        blocksPromptSection({richBlocks: false})
      )
        .filter((line) => line.includes("gallery"))
        .join("\n");
      expect(withoutHosts).toContain("image src rules");
      expect(withoutHosts).not.toContain("https");
      const withHosts = blocksPromptSection({imageHosts: ["cdn.example.com"]});
      expect(withHosts).toContain(
        "An https image src must use one of these hosts: cdn.example.com."
      );
      expect(blocksPromptSection()).toContain(
        "Do not emit an https image src. Use a data:image URL or a file: ref."
      );
    });

    it("prints every gallery limit from BLOCK_LIMITS in the gallery lines", () => {
      const galleryLines = linesAdded(
        blocksPromptSection(),
        blocksPromptSection({richBlocks: false})
      )
        .filter((line) => line.includes("gallery"))
        .join("\n");
      const galleryLimits = Object.entries(BLOCK_LIMITS).filter(([key]) =>
        key.startsWith("gallery")
      );
      expect(galleryLimits.length).toBe(4);
      for (const [, value] of galleryLimits) {
        expect(galleryLines).toContain(String(value));
      }
    });
  });

  describe("the list line", () => {
    const listLines = (): string =>
      linesAdded(blocksPromptSection(), blocksPromptSection({richBlocks: false}))
        .filter((line) => LIST_WORD.test(line))
        .join("\n");

    it("is on by default and lists list as a block type", () => {
      expect(blocksPromptSection()).toContain(LIST_LINE_START);
      for (const allowHtml of [false, true]) {
        const typesLine = blocksPromptSection({allowHtml})
          .split("\n")
          .find((line) => line.startsWith("Block types:"));
        expect(typesLine).toMatch(/, gallery, list[.,]/);
      }
    });

    it("names the list block only in its own lines, never as a generic word", () => {
      const section = blocksPromptSection({
        checklistActions: ["toggleChecklist"],
        stepperActions: ["scaleStepper"],
      });
      const mentions = section.split("\n").filter((line) => LIST_WORD.test(line));
      expect(mentions.length).toBe(4);
      expect(mentions[0]).toStartWith("Block types:");
      expect(mentions[1]).toStartWith(LIST_LINE_START);
      expect(mentions[2]).toStartWith("A list item");
      expect(mentions[3]).toStartWith(COPY_LINE_START);
    });

    it("sends item image srcs to the image rules and keeps the https rule tied to imageHosts", () => {
      const lines = listLines();
      expect(lines).toContain("image src rules");
      expect(lines).toContain("plain text");
      expect(lines).not.toContain("https");
    });

    it("prints every list limit from BLOCK_LIMITS and the image block's alt limit", () => {
      const lines = listLines();
      const listLimits = Object.entries(BLOCK_LIMITS).filter(([key]) => key.startsWith("list"));
      expect(listLimits.length).toBe(5);
      for (const [, value] of listLimits) {
        expect(lines).toContain(String(value));
      }
      expect(lines).toContain(`image alt ${BLOCK_LIMITS.headingTextMaxLength}`);
    });
  });

  describe("the card eyebrow line", () => {
    const eyebrowLines = (): string[] =>
      linesAdded(blocksPromptSection(), blocksPromptSection({richBlocks: false})).filter((line) =>
        line.includes("eyebrow")
      );

    it("is offered by default with its limit from BLOCK_LIMITS", () => {
      const lines = eyebrowLines();
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain(`at most ${BLOCK_LIMITS.cardEyebrowMaxLength}`);
      expect(BLOCK_LIMITS.cardEyebrowMaxLength).toBe(60);
    });

    it("is absent when richBlocks is false", () => {
      expect(blocksPromptSection({richBlocks: false})).not.toContain("eyebrow");
      expect(blocksPromptSection({allowHtml: true, richBlocks: false})).not.toContain("eyebrow");
    });
  });

  describe("the copy line", () => {
    const copyLines = (options: Parameters<typeof blocksPromptSection>[0] = {}): string[] =>
      linesAdded(
        blocksPromptSection(options),
        blocksPromptSection({...options, richBlocks: false})
      ).filter((line) => line.includes("copy"));

    it("is one line, on by default, with the copy text limit from BLOCK_LIMITS", () => {
      const lines = copyLines();
      expect(lines.length).toBe(1);
      expect(lines[0]).toStartWith(COPY_LINE_START);
      expect(lines[0]).toContain("exactly one of text");
      expect(lines[0]).toContain(`at most ${BLOCK_LIMITS.copyTextMaxLength} characters`);
      expect(lines[0]).toContain("never reaches the host");
    });

    it("names stepper as a copy target only when the stepper is offered", () => {
      expect(copyLines()[0]).toContain("a checklist, list, table, or text block");
      expect(copyLines()[0]).not.toContain("stepper");
      expect(copyLines({stepperActions: ["scaleStepper"]})[0]).toContain(
        "a stepper, checklist, list, table, or text block"
      );
    });

    it("is absent when richBlocks is false", () => {
      for (const allowHtml of [false, true]) {
        expect(blocksPromptSection({allowHtml, richBlocks: false})).not.toContain("copy");
      }
    });
  });

  describe("with richBlocks on", () => {
    it("matches the full rich-blocks prompt with stepper and checklist actions", () => {
      const section = blocksPromptSection(FULL_RICH_OPTIONS);
      expect(section).toBe(blocksPromptSection({...FULL_RICH_OPTIONS, richBlocks: true}));
      expect(section).toMatchSnapshot();
    });

    it("matches the full rich-blocks prompt with html allowed", () => {
      expect(blocksPromptSection({...FULL_RICH_OPTIONS, allowHtml: true})).toMatchSnapshot();
    });
  });
});
