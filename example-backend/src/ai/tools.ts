import {GptHistory, registerAiDataset} from "@terreno/ai";
import type {Tool} from "ai";
import {tool, zodSchema} from "ai";
import type mongoose from "mongoose";
import {z} from "zod";

import {Todo} from "../models/todo";

export const TODO_STATS_TOOL = "todoStats";

interface TodoStatsResult {
  datasetId: string | null;
  rowCount: number;
}

const columns = [
  {name: "status", type: "string" as const},
  {name: "count", type: "number" as const},
];

/**
 * Counts the signed-in user's open and completed todos and stores them as a `ref` dataset.
 * The model puts the returned `datasetId` on a chart dataset with `source: ref`.
 */
export const createTodoStatsTool = ({
  historyId,
  userId,
}: {
  historyId?: mongoose.Types.ObjectId | string;
  userId: mongoose.Types.ObjectId | string | undefined;
}): Record<string, Tool> => ({
  [TODO_STATS_TOOL]: tool({
    description:
      "Count the signed-in user's open and completed todos and store them for a chart. " +
      "The result's datasetId is a ref dataset. Columns are status (string) and count (number). " +
      "Rows are Open and Done. Reply with one block document whose chart uses that ref.",
    execute: async (): Promise<TodoStatsResult> => {
      if (!userId) {
        return {datasetId: null, rowCount: 0};
      }
      const open = await Todo.countDocuments({completed: false, ownerId: userId});
      const done = await Todo.countDocuments({completed: true, ownerId: userId});
      const history = historyId
        ? await GptHistory.findOneOrNone({_id: historyId, deleted: false, userId})
        : ((await GptHistory.find({deleted: false, userId}).sort({created: -1}).limit(1))[0] ??
          null);
      if (!history) {
        return {datasetId: null, rowCount: 0};
      }
      const registered = await registerAiDataset({
        columns,
        historyId: history._id,
        rows: [
          ["Open", open],
          ["Done", done],
        ],
        userId,
      });
      return {datasetId: registered.datasetId, rowCount: registered.rowCount};
    },
    inputSchema: zodSchema(z.object({}).strict()),
  }),
});
