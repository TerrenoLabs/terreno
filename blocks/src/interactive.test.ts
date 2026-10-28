import {describe, expect, it} from "bun:test";

import {
  applyChecklistState,
  isStepperValueAllowed,
  scaleStepperBlock,
  unknownChecklistItemIds,
} from "./interactive";
import type {Block, BlocksDocument, ChecklistBlock, StepperBlock} from "./schema";
import {validateBlocks} from "./validate";

// Built key by key because validateBlocks wants `v` before `blocks`.
const documentOf = (block: Block): BlocksDocument => {
  const doc = {v: 1} as BlocksDocument;
  doc.blocks = [block];
  return doc;
};

const STEPPER: StepperBlock = {
  callback: {name: "scaleStepper", payload: {recipe: "roast"}},
  id: "guests",
  items: [
    {amount: 2, decimals: 1, label: "Lamb", unit: "kg"},
    {amount: 7, label: "Parsnips", round: "up"},
    {amount: 625, label: "Broccoli", unit: "g"},
  ],
  label: "Number of people",
  max: 20,
  min: 1,
  note: "Generous portions.",
  type: "stepper",
  unit: "People",
  value: 5,
};

const CHECKLIST: ChecklistBlock = {
  callback: {name: "toggleChecklist"},
  id: "cooking",
  items: [
    {checked: true, id: "oven", meta: "1:00 pm", text: "Preheat the oven"},
    {id: "lamb_in", text: "Put the lamb in"},
    {id: "rest", text: "Rest the lamb"},
  ],
  title: "Cooking checklist",
  type: "checklist",
};

describe("scaleStepperBlock", () => {
  it("scales every item linearly from the original by its decimals and rounding", () => {
    const scaled = scaleStepperBlock(STEPPER, 6);
    expect(scaled.value).toBe(6);
    expect(scaled.items?.map((item) => item.amount)).toEqual([2.4, 9, 750]);
    expect(scaled.items?.[0]).toEqual({amount: 2.4, decimals: 1, label: "Lamb", unit: "kg"});
    expect(scaled.note).toBe("Generous portions.");
    expect(validateBlocks(documentOf(scaled)).ok).toBe(true);
  });

  it("returns the agent's amounts when scaled back to the original value", () => {
    expect(scaleStepperBlock(STEPPER, 5)).toEqual(STEPPER);
  });

  it("does not mutate the original", () => {
    const before = structuredClone(STEPPER);
    scaleStepperBlock(STEPPER, 10);
    expect(STEPPER).toEqual(before);
  });

  it("keeps the amounts as written when the original value is 0", () => {
    const zero: StepperBlock = {...STEPPER, min: 0, value: 0};
    expect(scaleStepperBlock(zero, 3).items?.map((item) => item.amount)).toEqual([2, 7, 625]);
  });

  it("only changes the value when there are no items", () => {
    const {items: _items, ...bare} = STEPPER;
    expect(scaleStepperBlock(bare, 9)).toEqual({...bare, value: 9});
  });
});

describe("isStepperValueAllowed", () => {
  it("accepts a finite value within the range on the step grid from the original", () => {
    expect(isStepperValueAllowed(STEPPER, 1)).toBe(true);
    expect(isStepperValueAllowed(STEPPER, 20)).toBe(true);
    expect(isStepperValueAllowed({...STEPPER, step: 0.5}, 5.5)).toBe(true);
  });

  it("rejects values outside the range, off the grid, or not finite", () => {
    expect(isStepperValueAllowed(STEPPER, 0)).toBe(false);
    expect(isStepperValueAllowed(STEPPER, 21)).toBe(false);
    expect(isStepperValueAllowed({...STEPPER, step: 2}, 6)).toBe(false);
    expect(isStepperValueAllowed(STEPPER, Number.NaN)).toBe(false);
    expect(isStepperValueAllowed(STEPPER, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("applyChecklistState", () => {
  it("takes every item's checked from state, with the ticked item taking checked", () => {
    const ticked = applyChecklistState(CHECKLIST, {
      checked: true,
      itemId: "lamb_in",
      state: {lamb_in: false, oven: true},
    });
    expect(ticked.items.map((item) => item.checked)).toEqual([true, true, false]);
    expect(ticked.items[0]).toEqual({
      checked: true,
      id: "oven",
      meta: "1:00 pm",
      text: "Preheat the oven",
    });
    expect(ticked.title).toBe("Cooking checklist");
    expect(validateBlocks(documentOf(ticked)).ok).toBe(true);
  });

  it("unchecks an item missing from state, even one the agent wrote as checked", () => {
    const ticked = applyChecklistState(CHECKLIST, {checked: true, itemId: "rest", state: {}});
    expect(ticked.items.map((item) => item.checked)).toEqual([false, false, true]);
  });

  it("does not mutate the original", () => {
    const before = structuredClone(CHECKLIST);
    applyChecklistState(CHECKLIST, {checked: false, itemId: "oven", state: {}});
    expect(CHECKLIST).toEqual(before);
  });
});

describe("unknownChecklistItemIds", () => {
  it("lists each id in the tick or state that the checklist does not have, once", () => {
    expect(
      unknownChecklistItemIds(CHECKLIST, {
        checked: true,
        itemId: "gravy",
        state: {gravy: true, oven: true, salad: false},
      })
    ).toEqual(["gravy", "salad"]);
  });

  it("is empty for a tick over known items", () => {
    expect(
      unknownChecklistItemIds(CHECKLIST, {checked: true, itemId: "oven", state: {rest: true}})
    ).toEqual([]);
  });
});
