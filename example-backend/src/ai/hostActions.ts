import type {HostActionContext, HostActionResult, UiBlocksOptions} from "@terreno/ai";
import {z} from "zod";

const exportPayload = z.object({dataset: z.string().min(1)}).strict();

/**
 * Replaces the actions block with a badge that names the dataset being exported.
 * The example does not write a file; it shows the callback round trip.
 */
const exportDataset = async ({payload}: HostActionContext): Promise<HostActionResult> => {
  const dataset = exportPayload.parse(payload).dataset;
  const badge: Record<string, string> = {};
  badge.type = "badge";
  badge.text = `Exporting ${dataset}`;
  badge.status = "info";
  const blocks: Record<string, unknown> = {};
  blocks.v = 1;
  blocks.blocks = [badge];
  return {blocks, replace: "block"};
};

/** Example chat callbacks. TTL stays at the default, which keeps stored datasets. */
export const exampleUiBlocksOptions: UiBlocksOptions = {
  hostActions: {
    exportDataset: {
      handler: exportDataset,
      payload: exportPayload,
    },
  },
  repair: true,
};
