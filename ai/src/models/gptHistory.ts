import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {GptHistoryDocument, GptHistoryModel} from "../types";

const contentPartSchema = new mongoose.Schema(
  {
    filename: {description: "Original filename of the attached file", type: String},
    mimeType: {description: "MIME type of the content part", type: String},
    text: {description: "Text content of this part", type: String},
    type: {
      description: "The kind of content this part represents",
      enum: ["text", "image", "file"],
      required: true,
      type: String,
    },
    url: {description: "URL pointing to the content resource", type: String},
  },
  {_id: false, strict: "throw"}
);

const gptHistoryPromptSchema = new mongoose.Schema(
  {
    args: {description: "Arguments passed to a tool call", type: mongoose.Schema.Types.Mixed},
    content: {description: "Multipart content attached to this prompt", type: [contentPartSchema]},
    model: {description: "AI model identifier used for this prompt", type: String},
    rating: {
      description: "User feedback rating for this prompt",
      enum: ["up", "down"],
      type: String,
    },
    result: {description: "Result returned from a tool call", type: mongoose.Schema.Types.Mixed},
    text: {
      default: "",
      description: "Text content of the prompt or response",
      // Image-only responses carry their payload in content, not text
      required: function (this: {content?: unknown[]}): boolean {
        return !this.content?.length;
      },
      type: String,
    },
    toolCallId: {
      description: "Identifier linking a tool result to its originating call",
      type: String,
    },
    toolName: {description: "Name of the tool that was invoked", type: String},
    type: {
      description: "Role of this message in the conversation",
      enum: ["user", "assistant", "system", "tool-call", "tool-result"],
      required: true,
      type: String,
    },
  },
  {_id: false, strict: "throw"}
);

const gptHistorySchema = new mongoose.Schema<GptHistoryDocument, GptHistoryModel>(
  {
    projectId: {
      description: "Project this conversation belongs to",
      index: true,
      ref: "Project",
      type: mongoose.Schema.Types.ObjectId,
    },
    prompts: {
      default: [],
      description: "Ordered list of messages in this conversation",
      type: [gptHistoryPromptSchema],
    },
    title: {description: "Auto-generated title from the first assistant response", type: String},
    userId: {
      description: "The user who owns this conversation history",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

gptHistorySchema.plugin(createdUpdatedPlugin);
gptHistorySchema.plugin(isDeletedPlugin);
gptHistorySchema.plugin(findOneOrNone);
gptHistorySchema.plugin(findExactlyOne);

// Virtual ownerId alias so Permissions.IsOwner works with userId field
gptHistorySchema.virtual("ownerId").get(function () {
  return this.userId;
});

export const GptHistory = mongoose.model<GptHistoryDocument, GptHistoryModel>(
  "GptHistory",
  gptHistorySchema
);
