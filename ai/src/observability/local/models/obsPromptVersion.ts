import {
  APIError,
  createdUpdatedPlugin,
  findExactlyOne,
  findOneOrNone,
  isDeletedPlugin,
} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsPromptVersionDocument, ObsPromptVersionModel} from "../../../types/observability";

const obsPromptVersionSchema = new mongoose.Schema<ObsPromptVersionDocument, ObsPromptVersionModel>(
  {
    config: {
      description: "Version config such as temperature preset and model hint",
      type: mongoose.Schema.Types.Mixed,
    },
    inputSchema: {
      description: "JSON Schema describing expected playground / dataset input",
      type: mongoose.Schema.Types.Mixed,
    },
    outputFieldNotes: {
      description: "Per-output-field notes shown to human reviewers",
      type: mongoose.Schema.Types.Mixed,
    },
    outputSchema: {
      description: "JSON Schema describing expected model output",
      type: mongoose.Schema.Types.Mixed,
    },
    promptId: {
      description: "Prompt this immutable version belongs to",
      ref: "ObsPrompt",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    sensitive: {
      default: false,
      description: "When true, traces inherit sensitive unless the generate call overrides it",
      type: Boolean,
    },
    system: {
      description: "System prompt body for this version",
      type: String,
    },
    template: {
      description: "User-facing template body, including {{variable}} placeholders",
      type: String,
    },
    type: {
      description: "Prompt shape: a single text template or a chat transcript",
      enum: ["chat", "text"],
      required: true,
      type: String,
    },
    variables: {
      default: [],
      description: "Named template variables with reviewer labels",
      type: [
        {
          key: {
            description: "Variable key used in {{key}} placeholders",
            required: true,
            type: String,
          },
          label: {description: "Human label shown on review given-panels", type: String},
          required: {
            default: true,
            description: "Whether the playground requires this variable",
            type: Boolean,
          },
          reviewerNote: {
            description: "Guidance shown next to this field in human review",
            type: String,
          },
        },
      ],
    },
    version: {
      description: "Monotonic version number starting at 1",
      required: true,
      type: Number,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsPromptVersionSchema.plugin(createdUpdatedPlugin);
obsPromptVersionSchema.plugin(isDeletedPlugin);
obsPromptVersionSchema.plugin(findOneOrNone);
obsPromptVersionSchema.plugin(findExactlyOne);
obsPromptVersionSchema.index({promptId: 1, version: 1}, {unique: true});

obsPromptVersionSchema.pre("save", function () {
  if (!this.isNew) {
    throw new APIError({status: 400, title: "ObsPromptVersion documents are immutable"});
  }
});

export const registerObsPromptVersion = (): ObsPromptVersionModel => {
  if (mongoose.models.ObsPromptVersion) {
    return mongoose.models.ObsPromptVersion as ObsPromptVersionModel;
  }
  return mongoose.model<ObsPromptVersionDocument, ObsPromptVersionModel>(
    "ObsPromptVersion",
    obsPromptVersionSchema
  );
};
