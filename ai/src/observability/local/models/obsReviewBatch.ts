import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsReviewBatchDocument, ObsReviewBatchModel} from "../../../types/observability";

const obsReviewBatchSchema = new mongoose.Schema<ObsReviewBatchDocument, ObsReviewBatchModel>(
  {
    description: {description: "Operator note about why this batch exists", type: String},
    evaluatorId: {
      description: "Human evaluator whose questions reviewers answer for every item",
      ref: "ObsEvaluator",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    name: {description: "Operator-facing batch name", required: true, type: String},
    promptName: {
      description: "Prompt the batch traces were drawn from, when filtered by prompt",
      type: String,
    },
    traceIds: {
      default: [],
      description: "Traces (one input and one output each) included in the batch",
      type: [{ref: "ObsTrace", type: mongoose.Schema.Types.ObjectId}],
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsReviewBatchSchema.plugin(createdUpdatedPlugin);
obsReviewBatchSchema.plugin(isDeletedPlugin);
obsReviewBatchSchema.plugin(findOneOrNone);
obsReviewBatchSchema.plugin(findExactlyOne);
obsReviewBatchSchema.index({evaluatorId: 1});

export const registerObsReviewBatch = (): ObsReviewBatchModel => {
  if (mongoose.models.ObsReviewBatch) {
    return mongoose.models.ObsReviewBatch as ObsReviewBatchModel;
  }
  return mongoose.model<ObsReviewBatchDocument, ObsReviewBatchModel>(
    "ObsReviewBatch",
    obsReviewBatchSchema
  );
};
