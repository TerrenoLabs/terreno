import {APIError, z} from "@terreno/api";
import {isStepperValueAllowed, scaleStepperBlock} from "@terreno/blocks";

import type {HostAction, HostActionResult} from "../types";
import {blocksDocument, findAgentBlock} from "./agentBlocks";

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
    if (!isStepperValueAllowed(stepper, value)) {
      throw new APIError({
        detail: `value must be between ${stepper.min} and ${stepper.max} in steps of ${stepper.step ?? 1} from ${stepper.value}.`,
        status: 400,
        title: "Invalid stepper value",
      });
    }
    return {blocks: blocksDocument([scaleStepperBlock(stepper, value)]), replace: "block"};
  },
  handles: "stepper",
  logResponse: false,
  payload: z.object({value: z.number()}).passthrough(),
};
