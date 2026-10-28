import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsSpanDocument, ObsSpanModel} from "../../../types/observability";

const obsSpanSchema = new mongoose.Schema<ObsSpanDocument, ObsSpanModel>(
  {
    durationMs: {description: "Span duration in milliseconds", type: Number},
    endedAt: {description: "When this span finished", type: Date},
    error: {description: "Short error cause when status is error", type: String},
    input: {description: "Span input payload", type: mongoose.Schema.Types.Mixed},
    kind: {
      description: "OpenInference span kind",
      enum: ["AGENT", "CHAIN", "EVALUATOR", "LLM", "RETRIEVER", "TOOL"],
      required: true,
      type: String,
    },
    name: {description: "Span display name", required: true, type: String},
    output: {description: "Span output payload", type: mongoose.Schema.Types.Mixed},
    parentSpanId: {
      description: "Parent span for nested waterfalls",
      ref: "ObsSpan",
      type: mongoose.Schema.Types.ObjectId,
    },
    sensitive: {
      description: "When true, this span's I/O is treated as sensitive",
      type: Boolean,
    },
    startedAt: {description: "When this span started", required: true, type: Date},
    startOffsetMs: {
      description: "Milliseconds after the root trace start",
      type: Number,
    },
    status: {
      description: "ok or error for this span",
      enum: ["error", "ok"],
      required: true,
      type: String,
    },
    traceId: {
      description: "Root trace this span belongs to",
      ref: "ObsTrace",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    usage: {
      description: "Per-span token and cost usage",
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsSpanSchema.plugin(createdUpdatedPlugin);
obsSpanSchema.plugin(isDeletedPlugin);
obsSpanSchema.plugin(findOneOrNone);
obsSpanSchema.plugin(findExactlyOne);
obsSpanSchema.index({traceId: 1});

export const registerObsSpan = (): ObsSpanModel => {
  if (mongoose.models.ObsSpan) {
    return mongoose.models.ObsSpan as ObsSpanModel;
  }
  return mongoose.model<ObsSpanDocument, ObsSpanModel>("ObsSpan", obsSpanSchema);
};
