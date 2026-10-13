import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsPromptLabelDocument, ObsPromptLabelModel} from "../../../types/observability";

const obsPromptLabelSchema = new mongoose.Schema<ObsPromptLabelDocument, ObsPromptLabelModel>(
  {
    label: {
      description: "Movable label such as production, latest, or staging",
      required: true,
      type: String,
    },
    promptId: {
      description: "Prompt this label belongs to",
      ref: "ObsPrompt",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    versionId: {
      description: "Immutable version currently pointed at by this label",
      ref: "ObsPromptVersion",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsPromptLabelSchema.plugin(createdUpdatedPlugin);
obsPromptLabelSchema.plugin(isDeletedPlugin);
obsPromptLabelSchema.plugin(findOneOrNone);
obsPromptLabelSchema.plugin(findExactlyOne);
obsPromptLabelSchema.index({label: 1, promptId: 1}, {unique: true});

export const registerObsPromptLabel = (): ObsPromptLabelModel => {
  if (mongoose.models.ObsPromptLabel) {
    return mongoose.models.ObsPromptLabel as ObsPromptLabelModel;
  }
  return mongoose.model<ObsPromptLabelDocument, ObsPromptLabelModel>(
    "ObsPromptLabel",
    obsPromptLabelSchema
  );
};
