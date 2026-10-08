import {describe, expect, it} from "bun:test";

import {blockPlainText} from "./plainText";
import type {
  ChecklistBlock,
  InlineDataset,
  ListBlock,
  StepperBlock,
  TableBlock,
  TextBlock,
} from "./schema";

const stepper: StepperBlock = {
  callback: {name: "scaleStepper"},
  id: "people",
  items: [
    {amount: 2, decimals: 1, label: "Bone-in leg of lamb", unit: "kg"},
    {amount: 8, label: "Carrots"},
    {amount: 0.625, decimals: 3, label: "Broccoli", unit: "kg"},
  ],
  itemsTitle: "Your shopping quantities",
  label: "Number of people",
  max: 20,
  min: 1,
  note: "Generous portions.",
  type: "stepper",
  unit: "People",
  value: 5,
};

const checklist: ChecklistBlock = {
  id: "cooking",
  items: [
    {checked: true, id: "oven", meta: "1:00 pm", text: "Preheat the oven"},
    {detail: "Fat side up.", id: "lamb_in", text: "Put the lamb in"},
    {id: "rest", text: "Rest the lamb"},
  ],
  title: "Cooking checklist",
  type: "checklist",
};

const guests: InlineDataset = {
  columns: [
    {name: "guests", type: "number"},
    {name: "lamb_kg", type: "number"},
    {name: "note", type: "string"},
  ],
  rows: [
    [4, 1.6, "Small"],
    [6, 2.4, null],
  ],
};

const table: TableBlock = {
  data: "guests",
  id: "lamb_table",
  title: "How much lamb?",
  type: "table",
};

describe("blockPlainText", () => {
  describe("stepper", () => {
    it("writes the label, value, and unit, then one line per item formatted with decimals", () => {
      expect(blockPlainText(stepper)).toBe(
        [
          "Number of people: 5 People",
          "Bone-in leg of lamb: 2.0 kg",
          "Carrots: 8",
          "Broccoli: 0.625 kg",
        ].join("\n")
      );
    });

    it("omits a missing unit without a trailing space and writes only the first line without items", () => {
      const bare: StepperBlock = {...stepper, items: undefined, unit: undefined, value: 6};
      expect(blockPlainText(bare)).toBe("Number of people: 6");
    });

    it("copies the block it is given, so an override's value and amounts are what is copied", () => {
      const scaled: StepperBlock = {
        ...stepper,
        items: [{amount: 2.4, decimals: 1, label: "Bone-in leg of lamb", unit: "kg"}],
        value: 6,
      };
      expect(blockPlainText(scaled)).toBe(
        "Number of people: 6 People\nBone-in leg of lamb: 2.4 kg"
      );
    });
  });

  describe("checklist", () => {
    it("writes one [x] or [ ] line per item from each item's checked", () => {
      expect(blockPlainText(checklist)).toBe(
        "[x] Preheat the oven\n[ ] Put the lamb in\n[ ] Rest the lamb"
      );
    });

    it("uses the current toggles over each item's checked and ignores unknown ids", () => {
      expect(
        blockPlainText(checklist, {checked: {lamb_in: true, missing: true, oven: false}})
      ).toBe("[ ] Preheat the oven\n[x] Put the lamb in\n[ ] Rest the lamb");
    });
  });

  describe("list", () => {
    it("writes one - title: text line per item, and - title when an item has no text", () => {
      const list: ListBlock = {
        items: [
          {meta: "Main", text: "Rubbed with garlic.", title: "Roast leg of lamb"},
          {image: {alt: "Mint", src: "file:mint"}, title: "Mint sauce"},
        ],
        type: "list",
      };
      expect(blockPlainText(list)).toBe("- Roast leg of lamb: Rubbed with garlic.\n- Mint sauce");
    });
  });

  describe("table", () => {
    it("writes a header row, then the rows, tab-separated, with null cells empty", () => {
      expect(blockPlainText(table, {datasets: {guests}})).toBe(
        "guests\tlamb_kg\tnote\n4\t1.6\tSmall\n6\t2.4\t"
      );
    });

    it("follows the table's columns in their order", () => {
      expect(blockPlainText({...table, columns: ["lamb_kg", "guests"]}, {datasets: {guests}})).toBe(
        "lamb_kg\tguests\n1.6\t4\n2.4\t6"
      );
    });

    it("returns an empty string when the dataset is missing or is an unresolved ref", () => {
      expect(blockPlainText(table)).toBe("");
      expect(blockPlainText(table, {datasets: {}})).toBe("");
      expect(blockPlainText(table, {datasets: {guests: {id: "ds_1", source: "ref"}}})).toBe("");
    });
  });

  describe("text", () => {
    it("returns the markdown as written", () => {
      const text: TextBlock = {
        markdown: "**Tips**\n\n- Rest the lamb\n- Warm the plates",
        type: "text",
      };
      expect(blockPlainText(text)).toBe("**Tips**\n\n- Rest the lamb\n- Warm the plates");
    });
  });

  it("returns an empty string for a block a copy action cannot target", () => {
    expect(blockPlainText({text: "Menu", type: "heading"})).toBe("");
    expect(blockPlainText({children: [{markdown: "Hi", type: "text"}], type: "card"})).toBe("");
  });
});
