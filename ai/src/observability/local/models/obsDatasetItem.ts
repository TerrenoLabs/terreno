import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsDatasetItemDocument, ObsDatasetItemModel} from "../../../types/observability";

const obsDatasetItemSchema = new mongoose.Schema<ObsDatasetItemDocument, ObsDatasetItemModel>(
  {
    annotatedBy: {
      description: "Who approved the expected output for provenance display",
      type: {
        label: {description: "Human-readable attribution label", required: true, type: String},
        reviewItemId: {description: "Optional review queue item id", type: String},
        userId: {description: "Optional user id for the annotator", type: String},
      },
    },
    datasetId: {
      description: "Parent dataset id",
      ref: "ObsDataset",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    expectedOutput: {
      description: "Human- or machine-authored expected output label",
      type: mongoose.Schema.Types.Mixed,
    },
    input: {
      description: "Dataset item input payload",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
    metadata: {
      description: "Additional import metadata",
      type: mongoose.Schema.Types.Mixed,
    },
    origin: {
      description: "How this item entered the dataset",
      enum: ["manual", "synthetic", "trace"],
      required: true,
      type: String,
    },
    outcomeClass: {
      description: "Optional confusion-matrix class for classification features",
      enum: ["fn", "fp", "tn", "tp"],
      type: String,
    },
    proofread: {
      default: false,
      description: "When true, the item is treated as human-annotated",
      type: Boolean,
    },
    sourceTraceId: {
      description: "Trace copied into this item, when origin is trace",
      ref: "ObsTrace",
      type: mongoose.Schema.Types.ObjectId,
    },
    tags: {
      default: [],
      description: "Item-level tags for filtering experiments",
      type: [String],
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsDatasetItemSchema.plugin(createdUpdatedPlugin);
obsDatasetItemSchema.plugin(isDeletedPlugin);
obsDatasetItemSchema.plugin(findOneOrNone);
obsDatasetItemSchema.plugin(findExactlyOne);
obsDatasetItemSchema.index({datasetId: 1, origin: 1, proofread: 1});
obsDatasetItemSchema.index({created: -1, datasetId: 1});

export const registerObsDatasetItem = (): ObsDatasetItemModel => {
  if (mongoose.models.ObsDatasetItem) {
    return mongoose.models.ObsDatasetItem as ObsDatasetItemModel;
  }
  return mongoose.model<ObsDatasetItemDocument, ObsDatasetItemModel>(
    "ObsDatasetItem",
    obsDatasetItemSchema
  );
};
