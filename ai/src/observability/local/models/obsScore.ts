import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsScoreDocument, ObsScoreModel} from "../../../types/observability";

const obsScoreSchema = new mongoose.Schema<ObsScoreDocument, ObsScoreModel>(
  {
    comment: {description: "Optional human or judge comment", type: String},
    confidence: {description: "Optional confidence in 0–1", type: Number},
    dataType: {
      description: "How to interpret value",
      enum: ["boolean", "categorical", "numeric"],
      required: true,
      type: String,
    },
    evaluatorId: {
      description: "Evaluator that produced this score when applicable",
      ref: "ObsEvaluator",
      type: mongoose.Schema.Types.ObjectId,
    },
    name: {description: "Score dimension or name", required: true, type: String},
    source: {
      description: "Who wrote the score",
      enum: ["code", "human", "llm-judge", "user-feedback"],
      required: true,
      type: String,
    },
    spanId: {
      description: "Optional span this score attaches to",
      ref: "ObsSpan",
      type: mongoose.Schema.Types.ObjectId,
    },
    traceId: {
      description: "Trace this score attaches to",
      ref: "ObsTrace",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    value: {
      description: "Score value; type matches dataType",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsScoreSchema.plugin(createdUpdatedPlugin);
obsScoreSchema.plugin(isDeletedPlugin);
obsScoreSchema.plugin(findOneOrNone);
obsScoreSchema.plugin(findExactlyOne);
obsScoreSchema.index({traceId: 1});

export const registerObsScore = (): ObsScoreModel => {
  if (mongoose.models.ObsScore) {
    return mongoose.models.ObsScore as ObsScoreModel;
  }
  return mongoose.model<ObsScoreDocument, ObsScoreModel>("ObsScore", obsScoreSchema);
};
