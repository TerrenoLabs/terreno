import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {AIDatasetDocument, AIDatasetModel, AIDatasetSchema} from "../types";

const columnSchema = new mongoose.Schema(
  {
    name: {
      description: "Column name used by chart and table blocks",
      required: true,
      type: String,
    },
    type: {
      description: "Cell type: string, number, or date",
      enum: ["string", "number", "date"],
      required: true,
      type: String,
    },
  },
  {_id: false}
);

const aiDatasetSchema: AIDatasetSchema = new mongoose.Schema(
  {
    columns: {
      description: "Named columns and their cell types, at most 12",
      required: true,
      type: [columnSchema],
    },
    expiresAt: {
      description: "When this dataset expires. Absent datasets are kept.",
      type: Date,
    },
    historyId: {
      description: "The conversation whose tool stored these rows",
      index: true,
      ref: "GptHistory",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    rowCount: {
      description: "How many rows were stored",
      required: true,
      type: Number,
    },
    rows: {
      description: "Table cells, one array per row, aligned with columns",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
    userId: {
      description: "The user who ran the tool that stored these rows",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

aiDatasetSchema.plugin(createdUpdatedPlugin);
aiDatasetSchema.plugin(isDeletedPlugin);
aiDatasetSchema.plugin(findOneOrNone);
aiDatasetSchema.plugin(findExactlyOne);

// Documents with no expiresAt are kept. expireAfterSeconds 0 deletes at the stored instant.
aiDatasetSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

// Virtual ownerId alias so Permissions.IsOwner works with userId field
aiDatasetSchema.virtual("ownerId").get(function (this: AIDatasetDocument) {
  return this.userId;
});

export const AIDataset = mongoose.model<AIDatasetDocument, AIDatasetModel>(
  "AIDataset",
  aiDatasetSchema
);
