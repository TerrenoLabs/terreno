import {describe, expect, it} from "bun:test";
import {isAPIError} from "@terreno/api";
import {type StepperBlock, validateBlocks} from "@terreno/blocks";

import {GptHistory} from "../models/gptHistory";
import type {GptHistoryDocument, HostActionContext} from "../types";
import {scaleStepperHostAction} from "./scaleStepper";

const ROAST = `v: 1
blocks:
  - type: stepper
    id: guests
    label: Number of people
    unit: People
    value: 5
    min: 1
    max: 20
    callback:
      name: scaleStepper
      payload:
        recipe: roast
    items:
      - {label: Lamb, amount: 2, unit: kg, decimals: 1}
      - {label: Parsnips, amount: 7, round: up}
      - {label: Broccoli, amount: 625, unit: g}
    note: Generous portions.
`;

const history = new GptHistory({
  prompts: [
    {text: "Plan a roast", type: "user"},
    {text: ROAST, type: "assistant"},
  ],
  userId: "000000000000000000000001",
}) as unknown as GptHistoryDocument;

const run = async (payload: unknown, blockId = "guests"): Promise<unknown> => {
  const context: HostActionContext = {
    blockId,
    elementId: `${blockId}_increase`,
    history,
    messageId: "msg-1",
    payload,
    user: {},
  };
  return scaleStepperHostAction.handler?.(context);
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

describe("scaleStepperHostAction", () => {
  it("declares a stepper action that keeps the block out of the log", () => {
    expect(scaleStepperHostAction.handles).toBe("stepper");
    expect(scaleStepperHostAction.logResponse).toBe(false);
  });

  it("accepts extra agent payload keys and rejects a non-number value", () => {
    const schema = scaleStepperHostAction.payload;
    expect(schema?.safeParse({recipe: "roast", value: 6}).success).toBe(true);
    expect(schema?.safeParse({value: "6"}).success).toBe(false);
    expect(schema?.safeParse({}).success).toBe(false);
  });

  it("scales every item from the agent's stepper by its decimals and rounding", async () => {
    const result = (await run({recipe: "roast", value: 6})) as {
      blocks: {blocks: StepperBlock[]; v: 1};
      replace: string;
    };
    expect(result.replace).toBe("block");
    expect(validateBlocks(result.blocks).ok).toBe(true);
    expect(result.blocks.v).toBe(1);
    expect(result.blocks.blocks).toHaveLength(1);
    const stepper = result.blocks.blocks[0];
    expect(stepper?.value).toBe(6);
    expect(stepper?.items?.map((item) => item.amount)).toEqual([2.4, 9, 750]);
    expect(stepper?.note).toBe("Generous portions.");
    expect(stepper?.callback).toEqual({name: "scaleStepper", payload: {recipe: "roast"}});
  });

  it("scales from the stored original, not from the previous tap", async () => {
    const result = (await run({value: 1})) as {blocks: {blocks: StepperBlock[]}};
    expect(result.blocks.blocks[0]?.items?.map((item) => item.amount)).toEqual([0.4, 2, 125]);
  });

  it("returns 400 for a value outside min and max or off the step grid", async () => {
    expect(await statusOf(() => run({value: 21}))).toBe(400);
    expect(await statusOf(() => run({value: 0}))).toBe(400);
    expect(await statusOf(() => run({value: 5.5}))).toBe(400);
    expect(await statusOf(() => run({value: Number.NaN}))).toBe(400);
  });

  it("returns 404 when the agent wrote no stepper with that id", async () => {
    expect(await statusOf(() => run({value: 6}, "missing"))).toBe(404);
  });
});
