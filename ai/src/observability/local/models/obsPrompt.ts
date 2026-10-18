import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsPromptDocument, ObsPromptModel} from "../../../types/observability";

const obsPromptSchema = new mongoose.Schema<ObsPromptDocument, ObsPromptModel>(
  {
    description: {
      description: "Optional operator-facing summary of what this prompt is for",
      type: String,
    },
    folder: {
      description: "Folder path used to group prompts in the admin list",
      required: true,
      type: String,
    },
    name: {
      description: "Unique prompt name used by PromptRegistry.get",
      required: true,
      type: String,
    },
    tags: {
      default: [],
      description: "Freeform tags for filtering prompts",
      type: [String],
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsPromptSchema.plugin(createdUpdatedPlugin);
obsPromptSchema.plugin(isDeletedPlugin);
obsPromptSchema.plugin(findOneOrNone);
obsPromptSchema.plugin(findExactlyOne);
obsPromptSchema.index({name: 1}, {unique: true});
obsPromptSchema.index({folder: 1, name: 1});

export const registerObsPrompt = (): ObsPromptModel => {
  if (mongoose.models.ObsPrompt) {
    return mongoose.models.ObsPrompt as ObsPromptModel;
  }
  return mongoose.model<ObsPromptDocument, ObsPromptModel>("ObsPrompt", obsPromptSchema);
};
