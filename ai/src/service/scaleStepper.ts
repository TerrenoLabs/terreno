import {APIError, z} from "@terreno/api";
import type {StepperBlock, StepperItem} from "@terreno/blocks";

import type {HostAction, HostActionResult} from "../types";
import {blocksDocument, findAgentBlock} from "./agentBlocks";

/** Tolerance for float noise when checking the step grid and rounding up. */
const EPSILON = 1e-9;

const roundAmount = (amount: number, item: StepperItem): number => {
  const factor = 10 ** (item.decimals ?? 0);
  const scaled = amount * factor;
  const rounded = item.round === "up" ? Math.ceil(scaled - EPSILON) : Math.round(scaled);
  return Number((rounded / factor).toFixed(item.decimals ?? 0));
};

const isOnGrid = (stepper: StepperBlock, value: number): boolean => {
  const steps = (value - stepper.value) / (stepper.step ?? 1);
  return Math.abs(steps - Math.round(steps)) < EPSILON;
};

const scaledStepper = (stepper: StepperBlock, value: number): StepperBlock => {
  if (stepper.items === undefined) {
    return {...stepper, value};
  }
  // An agent value of 0 has no linear ratio; its amounts stay as written.
  const ratio = stepper.value === 0 ? 1 : value / stepper.value;
  return {
    ...stepper,
    items: stepper.items.map((item) => ({...item, amount: roundAmount(item.amount * ratio, item)})),
    value,
  };
};

/**
 * Opt-in `stepper` host action. Register it as `uiBlocks.hostActions.scaleStepper`. It reads the
 * stepper the agent wrote from the stored history and scales every item linearly from it, so
 * rounding never drifts tap after tap. Stored prompts are owner-writable: an app whose numbers
 * matter (prices, stock) should register its own `handles: "stepper"` action over its own data.
 */
export const scaleStepperHostAction: HostAction = {
  handler: ({blockId, history, messageId, payload}): HostActionResult => {
    const {value} = payload as {value: number};
    const stepper = findAgentBlock({blockId, history, messageId, type: "stepper"});
    if (
      !Number.isFinite(value) ||
      value < stepper.min ||
      value > stepper.max ||
      !isOnGrid(stepper, value)
    ) {
      throw new APIError({
        detail: `value must be between ${stepper.min} and ${stepper.max} in steps of ${stepper.step ?? 1} from ${stepper.value}.`,
        status: 400,
        title: "Invalid stepper value",
      });
    }
    return {blocks: blocksDocument([scaledStepper(stepper, value)]), replace: "block"};
  },
  handles: "stepper",
  logResponse: false,
  payload: z.object({value: z.number()}).passthrough(),
};
