import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import {ASK_KINDS} from "@terreno/blocks";
import mongoose from "mongoose";

import type {GptHistoryAskStatus, GptHistoryDocument, GptHistoryModel} from "../types";

const ASK_STATUSES: GptHistoryAskStatus[] = ["pending", "answered", "cancelled"];

const promptAskSchema = new mongoose.Schema(
  {
    kind: {
      description: "Ask kind; the model asked with the tool ask_<kind>",
      enum: ASK_KINDS,
      required: true,
      type: String,
    },
    status: {
      description:
        "pending while the user can answer; answered or cancelled once the ask is resolved",
      enum: ASK_STATUSES,
      required: true,
      type: String,
    },
  },
  {_id: false, strict: "throw"}
);

const pendingAskSchema = new mongoose.Schema(
  {
    created: {description: "When the model asked", required: true, type: Date},
    input: {
      description: "The validated ask input the model sent",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
    kind: {
      description: "Ask kind; the model asked with the tool ask_<kind>",
      enum: ASK_KINDS,
      required: true,
      type: String,
    },
    promptIndex: {
      description:
        "Number of leading prompts that form the paused turn's history, replayed before responseMessages on resume",
      required: true,
      type: Number,
    },
    responseMessages: {
      description:
        "AI SDK response messages of the paused turn, replayed verbatim with the answer on resume",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
    simple: {
      description:
        "Simple card (short text and up to three answer buttons) made when the ask was made",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
    toolCallId: {
      description: "Tool call id of the ask; an answer must name it",
      required: true,
      type: String,
    },
  },
  // `minimize` would drop empty objects the AI SDK requires on replay, such as a tool call's `input: {}`.
  {_id: false, minimize: false, strict: "throw"}
);

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
    ask: {
      description: "Set on tool-call rows where the model asked the user a question",
      type: promptAskSchema,
    },
    content: {description: "Multipart content attached to this prompt", type: [contentPartSchema]},
    model: {description: "AI model identifier used for this prompt", type: String},
    rating: {
      description: "User feedback rating for this prompt",
      enum: ["up", "down"],
      type: String,
    },
    result: {description: "Result returned from a tool call", type: mongoose.Schema.Types.Mixed},
    text: {description: "Text content of the prompt or response", required: true, type: String},
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
    pendingAsk: {
      description:
        "The ask this conversation is waiting on; cleared when the user answers or the ask is cancelled",
      type: pendingAskSchema,
    },
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
