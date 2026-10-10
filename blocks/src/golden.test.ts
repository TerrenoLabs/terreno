import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {parseBlocks} from "./parse";
import {blockPlainText} from "./plainText";
import type {Block, BlocksDocument} from "./schema";
import {validateBlocks} from "./validate";

const goldenPath = join(import.meta.dir, "fixtures", "golden", "sunday-roast.yaml");

// The roast reply needs these options: https images and both host callbacks.
const goldenOptions = {
  checklistActions: ["toggleChecklist"],
  hostActions: ["scaleStepper", "toggleChecklist"],
  imageHosts: ["images.example.com"],
  stepperActions: ["scaleStepper"],
};

const loadGolden = (): BlocksDocument => {
  const parsed = parseBlocks(readFileSync(goldenPath, "utf8"));
  if (!parsed.ok) {
    throw new Error(`sunday-roast.yaml did not parse: ${JSON.stringify(parsed.errors)}`);
  }
  const validated = validateBlocks(parsed.value, goldenOptions);
  if (!validated.ok) {
    throw new Error(`sunday-roast.yaml did not validate: ${JSON.stringify(validated.errors)}`);
  }
  return validated.doc;
};

const allBlocks = (blocks: readonly Block[]): Block[] => {
  return blocks.flatMap((block) =>
    block.type === "card" || block.type === "columns" ? [block, ...block.children] : [block]
  );
};

const blocksOfType = <T extends Block["type"]>(
  doc: BlocksDocument,
  type: T
): Extract<Block, {type: T}>[] => {
  return allBlocks(doc.blocks).filter(
    (block): block is Extract<Block, {type: T}> => block.type === type
  );
};

describe("sunday roast golden document", () => {
  it("validates with the roast host options and no warnings", () => {
    const parsed = parseBlocks(readFileSync(goldenPath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const validated = validateBlocks(parsed.value, goldenOptions);
    expect(validated.ok).toBe(true);
    expect(validated.warnings).toEqual([]);
    expect(allBlocks(loadGolden().blocks).length).toBeLessThanOrEqual(50);
  });

  it("fails without imageHosts, so it stays out of the option-less valid/ loop", () => {
    const parsed = parseBlocks(readFileSync(goldenPath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const validated = validateBlocks(parsed.value);
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    expect(new Set(validated.errors.map((error) => error.code))).toEqual(
      new Set(["IMAGE_HOST_NOT_ALLOWED"])
    );
  });

  it("rejects the stepper and checklist callbacks when the host lacks those actions", () => {
    const parsed = parseBlocks(readFileSync(goldenPath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const validated = validateBlocks(parsed.value, {
      checklistActions: [],
      hostActions: [],
      imageHosts: ["images.example.com"],
      stepperActions: [],
    });
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    expect(validated.errors.map((error) => error.code)).toEqual([
      "UNKNOWN_HOST_ACTION",
      "UNKNOWN_HOST_ACTION",
    ]);
  });

  it("reproduces the GPT-6 reply: title, gallery, summary card, and photo menu", () => {
    const doc = loadGolden();
    expect(doc.blocks[0]).toEqual({size: "lg", text: "Your Sunday lamb roast 🍷", type: "heading"});

    const [gallery] = blocksOfType(doc, "gallery");
    expect(gallery?.images.map((image) => image.alt)).toEqual([
      "Roast lamb",
      "Crispy roast potatoes",
      "Sunday roast inspiration",
    ]);

    const summary = blocksOfType(doc, "card").find((card) => card.eyebrow !== undefined);
    expect(summary?.eyebrow).toBe("Your dinner plan");
    expect(summary?.title).toBe("Sunday roast with friends");
    expect(summary?.children[0]?.type).toBe("text");

    const [menu] = blocksOfType(doc, "list");
    expect(menu?.items).toHaveLength(5);
    for (const item of menu?.items ?? []) {
      expect(item.image?.src).toStartWith("https://images.example.com/");
      expect(item.text).toBeDefined();
    }
  });

  it("puts the stepper and its copy button in one card", () => {
    const doc = loadGolden();
    const card = blocksOfType(doc, "card").find((block) =>
      block.children.some((child) => child.type === "stepper")
    );
    expect(card).toBeDefined();
    const stepper = card?.children.find((child) => child.type === "stepper");
    if (stepper?.type !== "stepper") {
      throw new Error("expected a stepper in the shopping card");
    }
    expect(stepper.itemsTitle).toBe("Your shopping quantities");
    expect(stepper.items).toHaveLength(6);
    expect(stepper.callback).toEqual({name: "scaleStepper"});
    expect([stepper.value, stepper.min, stepper.max, stepper.unit]).toEqual([5, 1, 20, "People"]);

    const copyActions = card?.children
      .filter((child) => child.type === "actions")
      .flatMap((child) => child.elements)
      .filter((element) => element.type === "button" && element.action.kind === "copy");
    expect(copyActions).toHaveLength(1);
    const [copyButton] = copyActions ?? [];
    expect(copyButton?.type === "button" ? copyButton.text : undefined).toBe("Copy shopping list");
    expect(copyButton?.type === "button" ? copyButton.action : undefined).toEqual({
      kind: "copy",
      target: stepper.id,
    });

    expect(blockPlainText(stepper)).toBe(
      [
        "Number of people: 5 People",
        "Bone-in leg of lamb: 2.0 kg",
        "Potatoes: 1500 g",
        "Carrots: 8",
        "Parsnips: 5",
        "Tenderstem broccoli: 625 g",
        "Apples for crumble: 4",
      ].join("\n")
    );
  });

  it("has the 8-item cooking checklist with the first item ticked, then the USDA note", () => {
    const doc = loadGolden();
    const [checklist] = blocksOfType(doc, "checklist");
    expect(checklist?.title).toBe("Cooking checklist");
    expect(checklist?.callback).toEqual({name: "toggleChecklist"});
    expect(checklist?.items).toHaveLength(8);
    expect(checklist?.items.map((item) => item.checked === true)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(checklist?.items.map((item) => item.meta)).toEqual([
      "Saturday",
      "12:30 PM",
      "1:30 PM",
      "2:30 PM",
      "3:30 PM",
      "4:15 PM",
      "4:45 PM",
      "5:00 PM",
    ]);

    const index = doc.blocks.findIndex((block) => block.type === "checklist");
    const note = doc.blocks[index + 1];
    expect(note?.type).toBe("context");
    expect(note?.type === "context" ? note.text : "").toContain("USDA");
  });

  it("includes the GPT-5.6 'How much lamb?' table bound to an inline dataset", () => {
    const doc = loadGolden();
    const [table] = blocksOfType(doc, "table");
    expect(table?.title).toBe("How much lamb?");
    const dataset = table?.data === undefined ? undefined : doc.datasets?.[table.data];
    expect(dataset).toEqual({
      columns: [
        {name: "guests", type: "number"},
        {name: "bone_in_lamb", type: "string"},
        {name: "potatoes", type: "string"},
      ],
      rows: [
        [4, "3–4 lb", "2 lb"],
        [6, "4–5 lb", "3 lb"],
        [8, "5–6 lb", "4 lb"],
        [10, "6–7½ lb", "5 lb"],
      ],
    });
  });

  it("ends with the hosting tips as text and three follow-up reply buttons", () => {
    const doc = loadGolden();
    const tips = blocksOfType(doc, "text").find((block) => block.id === "hosting_tips");
    expect(tips?.markdown).toContain("**Buy the lamb last:**");

    const last = doc.blocks[doc.blocks.length - 1];
    if (last?.type !== "actions") {
      throw new Error("expected the reply to end with follow-up actions");
    }
    expect(
      last.elements.map((element) =>
        element.type === "button" && element.action.kind === "reply" ? element.action.text : ""
      )
    ).toEqual([
      "Help me adjust the lamb roast plan for 5 guests",
      "Add vegetarian side dish options for the lamb roast menu",
      "Advise on making the lamb roast plan gluten-free",
    ]);
  });
});
