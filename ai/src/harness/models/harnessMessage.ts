import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import {
  HARNESS_MESSAGE_ROLES,
  type HarnessMessageDocument,
  type HarnessMessageModel,
} from "../../types/harness";

const harnessMessageSchema = new mongoose.Schema<HarnessMessageDocument, HarnessMessageModel>(
  {
    aborted: {
      default: false,
      description: "True when the message was cut off before it finished (partial stream)",
      type: Boolean,
    },
    conversationId: {
      description: "Conversation this message belongs to",
      ref: "HarnessConversation",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    parts: {
      default: () => [],
      description: "Content parts: an array of text, tool-call, or tool-result objects",
      type: mongoose.Schema.Types.Mixed,
    },
    requestId: {
      description:
        "Submitter's idempotency key on user messages from submit or send; unique per conversation",
      type: String,
    },
    role: {
      description: "Who produced the message: system, user, assistant, or tool",
      enum: Object.values(HARNESS_MESSAGE_ROLES),
      required: true,
      type: String,
    },
    seq: {
      description: "Position in the conversation; strictly increasing from 1",
      required: true,
      type: Number,
    },
    status: {
      description: "For tool messages: ok, or error when the call failed or was interrupted",
      enum: ["error", "ok"],
      type: String,
    },
    toolCallId: {description: "Tool call this tool message answers", type: String},
    toolName: {description: "Tool that produced this tool message", type: String},
    turnTaskId: {
      description: "Turn task that wrote this message",
      ref: "HarnessTask",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {
    // Keep empty objects: `{}` tool arguments and states are meaningful values.
    minimize: false,
    strict: "throw",
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  }
);

harnessMessageSchema.plugin(createdUpdatedPlugin);
harnessMessageSchema.plugin(isDeletedPlugin);
harnessMessageSchema.plugin(findOneOrNone);
harnessMessageSchema.plugin(findExactlyOne);
harnessMessageSchema.index({conversationId: 1, seq: 1}, {unique: true});
harnessMessageSchema.index(
  {conversationId: 1, requestId: 1},
  {partialFilterExpression: {requestId: {$type: "string"}}, unique: true}
);

export const registerHarnessMessage = (): HarnessMessageModel => {
  if (mongoose.models.HarnessMessage) {
    return mongoose.models.HarnessMessage as HarnessMessageModel;
  }
  return mongoose.model<HarnessMessageDocument, HarnessMessageModel>(
    "HarnessMessage",
    harnessMessageSchema
  );
};
