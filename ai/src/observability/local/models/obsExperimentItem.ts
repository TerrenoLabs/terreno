import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsExperimentItemDocument, ObsExperimentItemModel} from "../../../types/observability";

const obsExperimentItemSchema = new mongoose.Schema<
  ObsExperimentItemDocument,
  ObsExperimentItemModel
>(
  {
    datasetItemId: {
      description: "Dataset item evaluated in this experiment row",
      ref: "ObsDatasetItem",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    experimentId: {
      description: "Parent experiment id",
      ref: "ObsExperiment",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    failed: {
      default: false,
      description: "When true, this row failed a gate or evaluator",
      type: Boolean,
    },
    versionResults: {
      default: {},
      description: "Per-version outputs and evaluator score maps keyed by version number",
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsExperimentItemSchema.plugin(createdUpdatedPlugin);
obsExperimentItemSchema.plugin(isDeletedPlugin);
obsExperimentItemSchema.plugin(findOneOrNone);
obsExperimentItemSchema.plugin(findExactlyOne);
obsExperimentItemSchema.index({experimentId: 1, failed: 1});
obsExperimentItemSchema.index({datasetItemId: 1, experimentId: 1}, {unique: true});

export const registerObsExperimentItem = (): ObsExperimentItemModel => {
  if (mongoose.models.ObsExperimentItem) {
    return mongoose.models.ObsExperimentItem as ObsExperimentItemModel;
  }
  return mongoose.model<ObsExperimentItemDocument, ObsExperimentItemModel>(
    "ObsExperimentItem",
    obsExperimentItemSchema
  );
};
