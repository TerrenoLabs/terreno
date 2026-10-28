import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";
import mongoose from "mongoose";

import type {HarnessMemoDocument, HarnessMemoModel} from "../../types/harness";

const harnessMemoSchema = new mongoose.Schema<HarnessMemoDocument, HarnessMemoModel>(
  {
    key: {
      description: "Memo key, unique within its task",
      required: true,
      type: String,
    },
    taskId: {
      description: "Task the memo is scoped to (the turn task for extension hooks)",
      ref: "HarnessTask",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    value: {
      description: "First value written for the key (JSON); later writes keep it",
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    // Keep empty objects: `{}` is a meaningful memo value.
    minimize: false,
    strict: "throw",
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  }
);

harnessMemoSchema.plugin(createdUpdatedPlugin);
harnessMemoSchema.plugin(findOneOrNone);
harnessMemoSchema.plugin(findExactlyOne);
harnessMemoSchema.index({key: 1, taskId: 1}, {unique: true});

export const registerHarnessMemo = (): HarnessMemoModel => {
  if (mongoose.models.HarnessMemo) {
    return mongoose.models.HarnessMemo as HarnessMemoModel;
  }
  return mongoose.model<HarnessMemoDocument, HarnessMemoModel>("HarnessMemo", harnessMemoSchema);
};
