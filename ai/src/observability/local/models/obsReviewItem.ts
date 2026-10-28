import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsReviewItemDocument, ObsReviewItemModel} from "../../../types/observability";

const obsReviewItemSchema = new mongoose.Schema<ObsReviewItemDocument, ObsReviewItemModel>(
  {
    assigneeId: {
      description: "User assigned to review this item",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
    comment: {description: "Reviewer comment submitted with scores", type: String},
    datasetItemId: {
      description: "Optional dataset item this review is bound to",
      ref: "ObsDatasetItem",
      type: mongoose.Schema.Types.ObjectId,
    },
    enqueuedAt: {
      description: "When the item entered the queue",
      required: true,
      type: Date,
    },
    evaluatorId: {
      description: "Human evaluator that owns this review form",
      ref: "ObsEvaluator",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    reason: {
      description: "Why the item was enqueued",
      enum: ["dataset_candidate", "eval", "feedback", "manual"],
      required: true,
      type: String,
    },
    scores: {
      description: "Dimension-keyed scores written on submit",
      type: mongoose.Schema.Types.Mixed,
    },
    spanId: {
      description: "Optional span under review",
      ref: "ObsSpan",
      type: mongoose.Schema.Types.ObjectId,
    },
    status: {
      description: "Queue status",
      enum: ["done", "in_progress", "pending", "skipped"],
      required: true,
      type: String,
    },
    traceId: {
      description: "Trace under review",
      ref: "ObsTrace",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsReviewItemSchema.plugin(createdUpdatedPlugin);
obsReviewItemSchema.plugin(isDeletedPlugin);
obsReviewItemSchema.plugin(findOneOrNone);
obsReviewItemSchema.plugin(findExactlyOne);
const reviewIndexSpec: Array<[string, 1]> = [
  ["status", 1],
  ["enqueuedAt", 1],
];
obsReviewItemSchema.index(Object.fromEntries(reviewIndexSpec));

export const registerObsReviewItem = (): ObsReviewItemModel => {
  if (mongoose.models.ObsReviewItem) {
    return mongoose.models.ObsReviewItem as ObsReviewItemModel;
  }
  return mongoose.model<ObsReviewItemDocument, ObsReviewItemModel>(
    "ObsReviewItem",
    obsReviewItemSchema
  );
};
