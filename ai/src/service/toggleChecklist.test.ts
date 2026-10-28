import {describe, expect, it} from "bun:test";
import {isAPIError} from "@terreno/api";
import {type ChecklistBlock, validateBlocks} from "@terreno/blocks";

import {GptHistory} from "../models/gptHistory";
import type {GptHistoryDocument, HostActionContext} from "../types";
import {toggleChecklistHostAction} from "./toggleChecklist";

const ROAST = `v: 1
blocks:
  - type: checklist
    id: cook
    title: Cooking plan
    callback:
      name: toggleChecklist
      payload:
        recipe: roast
    items:
      - {id: preheat, text: Preheat the oven, meta: "12:00"}
      - {id: lamb, text: Lamb in, meta: "12:15", detail: Fat side up, checked: true}
      - {id: rest, text: Rest the lamb, meta: "13:45"}
`;

const history = new GptHistory({
  prompts: [
    {text: "Plan a roast", type: "user"},
    {text: ROAST, type: "assistant"},
  ],
  userId: "000000000000000000000001",
}) as unknown as GptHistoryDocument;

const run = async (payload: unknown, blockId = "cook"): Promise<unknown> => {
  const itemId = (payload as {itemId?: string}).itemId ?? "preheat";
  const context: HostActionContext = {
    blockId,
    elementId: `${blockId}_${itemId}`,
    history,
    messageId: "msg-1",
    payload,
    user: {},
  };
  return toggleChecklistHostAction.handler?.(context);
};

const statusOf = async (work: () => Promise<unknown>): Promise<number | undefined> => {
  try {
    await work();
  } catch (error) {
    if (isAPIError(error)) {
      return error.status;
    }
    throw error;
  }
  return undefined;
};

const checkedOf = (result: unknown): Record<string, boolean | undefined> => {
  const checklist = (result as {blocks: {blocks: ChecklistBlock[]}}).blocks.blocks[0];
  return Object.fromEntries((checklist?.items ?? []).map((item) => [item.id, item.checked]));
};

describe("toggleChecklistHostAction", () => {
  it("declares a checklist action that keeps the block out of the log", () => {
    expect(toggleChecklistHostAction.handles).toBe("checklist");
    expect(toggleChecklistHostAction.logResponse).toBe(false);
  });

  it("accepts extra agent payload keys and rejects a malformed tick", () => {
    const schema = toggleChecklistHostAction.payload;
    const tick = {
      checked: true,
      itemId: "preheat",
      state: {lamb: true, preheat: true, rest: false},
    };
    expect(schema?.safeParse({...tick, recipe: "roast"}).success).toBe(true);
    expect(schema?.safeParse({...tick, checked: "yes"}).success).toBe(false);
    expect(schema?.safeParse({...tick, state: {preheat: "yes"}}).success).toBe(false);
    expect(schema?.safeParse({checked: true, state: {}}).success).toBe(false);
    expect(schema?.safeParse({checked: true, itemId: "preheat"}).success).toBe(false);
  });

  it("returns the agent's checklist with checked set from state", async () => {
    const result = (await run({
      checked: true,
      itemId: "preheat",
      recipe: "roast",
      state: {lamb: false, preheat: true, rest: true},
    })) as {blocks: {blocks: ChecklistBlock[]; v: 1}; replace: string};
    expect(result.replace).toBe("block");
    expect(validateBlocks(result.blocks).ok).toBe(true);
    expect(result.blocks.v).toBe(1);
    expect(result.blocks.blocks).toHaveLength(1);
    const checklist = result.blocks.blocks[0];
    expect(checklist?.id).toBe("cook");
    expect(checklist?.title).toBe("Cooking plan");
    expect(checklist?.callback).toEqual({name: "toggleChecklist", payload: {recipe: "roast"}});
    expect(checklist?.items.map((item) => item.text)).toEqual([
      "Preheat the oven",
      "Lamb in",
      "Rest the lamb",
    ]);
    expect(checklist?.items[1]?.detail).toBe("Fat side up");
    expect(checkedOf(result)).toEqual({lamb: false, preheat: true, rest: true});
  });

  it("treats items missing from state as unchecked and keeps the ticked item as sent", async () => {
    const result = await run({checked: true, itemId: "rest", state: {}});
    expect(checkedOf(result)).toEqual({lamb: false, preheat: false, rest: true});

    const unticked = await run({checked: false, itemId: "lamb", state: {lamb: true}});
    expect(checkedOf(unticked)).toEqual({lamb: false, preheat: false, rest: false});
  });

  it("returns 400 for an item id or state key the checklist does not have", async () => {
    expect(await statusOf(() => run({checked: true, itemId: "carve", state: {}}))).toBe(400);
    expect(
      await statusOf(() => run({checked: true, itemId: "preheat", state: {carve: true}}))
    ).toBe(400);
  });

  it("returns 404 when the agent wrote no checklist with that id", async () => {
    expect(
      await statusOf(() => run({checked: true, itemId: "preheat", state: {}}, "missing"))
    ).toBe(404);
  });
});
