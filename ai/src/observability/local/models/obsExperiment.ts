import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsExperimentDocument, ObsExperimentModel} from "../../../types/observability";

const obsExperimentSchema = new mongoose.Schema<ObsExperimentDocument, ObsExperimentModel>(
  {
    backgroundTaskId: {
      description: "Background task executing this experiment locally",
      ref: "BackgroundTask",
      type: mongoose.Schema.Types.ObjectId,
    },
    datasetId: {
      description: "Dataset compared in this experiment",
      ref: "ObsDataset",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    estimate: {
      description: "Pre-run estimate shown in the wizard",
      type: mongoose.Schema.Types.Mixed,
    },
    evaluatorIds: {
      default: [],
      description: "Evaluators attached to this experiment",
      type: [{ref: "ObsEvaluator", type: mongoose.Schema.Types.ObjectId}],
    },
    includeUnproofread: {
      default: false,
      description: "When true, synthetic/unproofread items are included",
      type: Boolean,
    },
    modelOverride: {
      description: "Optional model id override for all generations",
      type: String,
    },
    name: {description: "Operator-facing experiment name", required: true, type: String},
    promptName: {
      description: "Prompt whose versions are compared",
      required: true,
      type: String,
    },
    results: {
      description: "Aggregated gate, outlier, and progress results",
      type: mongoose.Schema.Types.Mixed,
    },
    status: {
      default: "pending",
      description: "Experiment lifecycle status",
      enum: ["completed", "failed", "pending", "running"],
      required: true,
      type: String,
    },
    thresholds: {
      default: [],
      description: "Gate thresholds evaluated after the run",
      type: mongoose.Schema.Types.Mixed,
    },
    versions: {
      description: "Two or three prompt versions compared in this run",
      required: true,
      type: [Number],
      validate: {
        message: "experiments must compare 2–3 prompt versions",
        validator: (value: number[]) => {
          return value.length >= 2 && value.length <= 3;
        },
      },
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsExperimentSchema.plugin(createdUpdatedPlugin);
obsExperimentSchema.plugin(isDeletedPlugin);
obsExperimentSchema.plugin(findOneOrNone);
obsExperimentSchema.plugin(findExactlyOne);
obsExperimentSchema.index({created: -1, datasetId: 1});
obsExperimentSchema.index({created: -1, status: 1});
// biome-ignore assist/source/useSortedKeys: promptName must be the leading key for prompt-filtered lists
obsExperimentSchema.index({promptName: 1, created: -1});

export const registerObsExperiment = (): ObsExperimentModel => {
  if (mongoose.models.ObsExperiment) {
    return mongoose.models.ObsExperiment as ObsExperimentModel;
  }
  return mongoose.model<ObsExperimentDocument, ObsExperimentModel>(
    "ObsExperiment",
    obsExperimentSchema
  );
};
