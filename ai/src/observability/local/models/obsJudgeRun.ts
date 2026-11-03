import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsJudgeRunDocument, ObsJudgeRunModel} from "../../../types/observability";

const obsJudgeRunSchema = new mongoose.Schema<ObsJudgeRunDocument, ObsJudgeRunModel>(
  {
    batchId: {
      description: "Review batch the judge answered",
      ref: "ObsReviewBatch",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    completedAt: {description: "When the judge finished every item", required: true, type: Date},
    evaluatorId: {
      description: "LLM-judge evaluator that produced the answers",
      ref: "ObsEvaluator",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    modelId: {description: "Model id of the AI client that ran the judge", type: String},
    results: {
      default: [],
      description: "One judge answer set per batch trace",
      type: [
        {
          confidence: {description: "Judge confidence in 0–1 when returned", type: Number},
          datasetItemId: {
            description: "Dataset item the judge answered, for dataset review batches",
            ref: "ObsDatasetItem",
            type: mongoose.Schema.Types.ObjectId,
          },
          error: {description: "Why the judge could not answer this item", type: String},
          scores: {
            description: "Dimension-keyed judge answers",
            type: mongoose.Schema.Types.Mixed,
          },
          traceId: {
            description: "Trace the judge answered, unset for dataset items without a trace",
            ref: "ObsTrace",
            type: mongoose.Schema.Types.ObjectId,
          },
        },
      ],
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsJudgeRunSchema.plugin(createdUpdatedPlugin);
obsJudgeRunSchema.plugin(isDeletedPlugin);
obsJudgeRunSchema.plugin(findOneOrNone);
obsJudgeRunSchema.plugin(findExactlyOne);
obsJudgeRunSchema.index({batchId: 1, completedAt: -1});

export const registerObsJudgeRun = (): ObsJudgeRunModel => {
  if (mongoose.models.ObsJudgeRun) {
    return mongoose.models.ObsJudgeRun as ObsJudgeRunModel;
  }
  return mongoose.model<ObsJudgeRunDocument, ObsJudgeRunModel>("ObsJudgeRun", obsJudgeRunSchema);
};
