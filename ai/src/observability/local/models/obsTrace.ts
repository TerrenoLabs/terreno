import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsTraceDocument, ObsTraceModel} from "../../../types/observability";

const obsTraceSchema = new mongoose.Schema<ObsTraceDocument, ObsTraceModel>(
  {
    endedAt: {description: "When the root trace finished", type: Date},
    errorSummary: {
      description: "Short error copied from the first failed span",
      type: String,
    },
    flaggedForDataset: {
      default: false,
      description: "When true, operators marked this trace as a dataset candidate",
      type: Boolean,
    },
    input: {description: "Root trace input payload", type: mongoose.Schema.Types.Mixed},
    name: {description: "Trace display name", required: true, type: String},
    output: {description: "Root trace output payload", type: mongoose.Schema.Types.Mixed},
    prompts: {
      default: [],
      description: "Prompt versions used during this trace",
      type: [
        {
          label: {description: "Label resolved at call time", type: String},
          name: {description: "Prompt name", required: true, type: String},
          version: {description: "Prompt version number", required: true, type: Number},
        },
      ],
    },
    sensitive: {
      default: false,
      description: "When true, admin I/O disclosures start collapsed",
      type: Boolean,
    },
    sessionId: {description: "Client session identifier", type: String},
    startedAt: {description: "When the root trace started", required: true, type: Date},
    status: {
      description: "ok when every span succeeded, otherwise error",
      enum: ["error", "ok"],
      required: true,
      type: String,
    },
    usage: {
      description: "Aggregated token and cost usage for the trace",
      type: mongoose.Schema.Types.Mixed,
    },
    userId: {
      description: "User who initiated the generate call",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsTraceSchema.plugin(createdUpdatedPlugin);
obsTraceSchema.plugin(isDeletedPlugin);
obsTraceSchema.plugin(findOneOrNone);
obsTraceSchema.plugin(findExactlyOne);
// Compound index field order is query-significant; do not alphabetize keys.
const traceIndexSpecs: Array<Array<[string, -1 | 1]>> = [
  [
    ["created", -1],
    ["userId", 1],
  ],
  [
    ["sessionId", 1],
    ["created", -1],
  ],
  [
    ["status", 1],
    ["created", -1],
  ],
  [
    ["prompts.name", 1],
    ["prompts.version", 1],
  ],
  [
    ["flaggedForDataset", 1],
    ["created", -1],
  ],
];
for (const spec of traceIndexSpecs) {
  obsTraceSchema.index(Object.fromEntries(spec));
}

export const registerObsTrace = (): ObsTraceModel => {
  if (mongoose.models.ObsTrace) {
    return mongoose.models.ObsTrace as ObsTraceModel;
  }
  return mongoose.model<ObsTraceDocument, ObsTraceModel>("ObsTrace", obsTraceSchema);
};
