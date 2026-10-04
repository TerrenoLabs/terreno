import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsDatasetDocument, ObsDatasetModel} from "../../../types/observability";

const obsDatasetSchema = new mongoose.Schema<ObsDatasetDocument, ObsDatasetModel>(
  {
    description: {description: "Operator-facing dataset description", type: String},
    expectedOutputSchema: {
      description: "Optional JSON Schema for expected output labels",
      type: mongoose.Schema.Types.Mixed,
    },
    inputSchemaPromptName: {
      description: "Optional prompt whose production inputSchema validates imported items",
      type: String,
    },
    name: {description: "Unique dataset name", required: true, type: String},
    tags: {
      default: [],
      description: "Free-form dataset tags for filtering",
      type: [String],
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsDatasetSchema.plugin(createdUpdatedPlugin);
obsDatasetSchema.plugin(isDeletedPlugin);
obsDatasetSchema.plugin(findOneOrNone);
obsDatasetSchema.plugin(findExactlyOne);
obsDatasetSchema.index({name: 1}, {unique: true});

export const registerObsDataset = (): ObsDatasetModel => {
  if (mongoose.models.ObsDataset) {
    return mongoose.models.ObsDataset as ObsDatasetModel;
  }
  return mongoose.model<ObsDatasetDocument, ObsDatasetModel>("ObsDataset", obsDatasetSchema);
};
