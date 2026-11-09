import {APIError, z} from "@terreno/api";
import {
  applyChecklistState,
  type ChecklistBlock,
  type ChecklistTick,
  unknownChecklistItemIds,
} from "@terreno/blocks";

import type {HostAction, HostActionResult} from "../types";
import {blocksDocument, findAgentBlock} from "./agentBlocks";

const unknownItemError = (itemIds: string[], checklist: ChecklistBlock): APIError =>
  new APIError({
    detail: `${checklist.id} has no item ${itemIds.join(", ")}. Its items are ${checklist.items
      .map((item) => item.id)
      .join(", ")}.`,
    status: 400,
    title: "Unknown checklist item",
  });

/**
 * Opt-in `checklist` host action. Register it as `uiBlocks.hostActions.toggleChecklist`. It reads
 * the checklist the agent wrote from the stored history and returns it with every item's
 * `checked` taken from `state`. An item missing from `state` is unchecked, and the ticked item
 * always takes `checked`. Nothing is saved: an app that records progress should register its own
 * `handles: "checklist"` action.
 */
export const toggleChecklistHostAction: HostAction = {
  handler: ({blockId, history, messageId, payload}): HostActionResult => {
    const tick = payload as ChecklistTick;
    const checklist = findAgentBlock({blockId, history, messageId, type: "checklist"});
    const unknownIds = unknownChecklistItemIds(checklist, tick);
    if (unknownIds.length > 0) {
      throw unknownItemError(unknownIds, checklist);
    }
    const ticked = applyChecklistState(checklist, tick);
    return {blocks: blocksDocument([ticked]), replace: "block"};
  },
  handles: "checklist",
  logResponse: false,
  payload: z
    .object({checked: z.boolean(), itemId: z.string(), state: z.record(z.string(), z.boolean())})
    .passthrough(),
};
