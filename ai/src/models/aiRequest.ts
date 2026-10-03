import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {
  AIRequestDocument,
  AIRequestModel,
  LogMultiAgentRequestParams,
  LogRequestParams,
} from "../types";

const aiRequestSchema = new mongoose.Schema<AIRequestDocument, AIRequestModel>(
  {
    aiModel: {
      description: "The AI model identifier used for this request",
      required: true,
      type: String,
    },
    error: {description: "Error message if the request failed", type: String},
    metadata: {
      description: "Additional metadata associated with this request",
      type: mongoose.Schema.Types.Mixed,
    },
    parentRequestId: {
      description: "Reference to the parent request in a multi-agent workflow",
      ref: "AIRequest",
      type: mongoose.Schema.Types.ObjectId,
    },
    prompt: {description: "The input prompt sent to the AI model", required: true, type: String},
    requestType: {
      description:
        "The type of AI request (general, translation, summarization, ui_action, and the other default types)",
      required: true,
      type: String,
    },
    response: {description: "The AI model response text", type: String},
    responseTime: {description: "Response time in milliseconds", type: Number},
    subRequestIds: [
      {
        description: "References to child requests in a multi-agent workflow",
        ref: "AIRequest",
        type: mongoose.Schema.Types.ObjectId,
      },
    ],
    tokensUsed: {description: "Total tokens consumed by this request", type: Number},
    totalResponseTime: {
      description: "Combined response time across all sub-requests in milliseconds",
      type: Number,
    },
    totalTokensUsed: {
      description: "Combined tokens consumed across all sub-requests",
      type: Number,
    },
    userId: {
      description: "The user who initiated this request",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

aiRequestSchema.plugin(createdUpdatedPlugin);
aiRequestSchema.plugin(isDeletedPlugin);
aiRequestSchema.plugin(findOneOrNone);
aiRequestSchema.plugin(findExactlyOne);

aiRequestSchema.index({created: -1, userId: 1});
aiRequestSchema.index({aiModel: 1, created: -1});
aiRequestSchema.index({created: -1, requestType: 1});
aiRequestSchema.index({parentRequestId: 1});

aiRequestSchema.statics.logRequest = async function (
  this: AIRequestModel,
  params: LogRequestParams
): Promise<AIRequestDocument> {
  const request = new this(params);
  return request.save();
};

aiRequestSchema.statics.logMultiAgentRequest = async function (
  this: AIRequestModel,
  params: LogMultiAgentRequestParams
): Promise<AIRequestDocument> {
  const parent = await this.create({
    aiModel: params.aiModel,
    metadata: params.metadata ?? {},
    prompt: "[multi-agent parent request]",
    requestType: params.requestType,
    response: "",
    subRequestIds: params.subRequestIds,
    totalResponseTime: params.totalResponseTime,
    totalTokensUsed: params.totalTokensUsed,
    userId: params.userId,
  });

  await this.updateMany({_id: {$in: params.subRequestIds}}, {$set: {parentRequestId: parent._id}});

  return parent;
};

export const AIRequest = mongoose.model<AIRequestDocument, AIRequestModel>(
  "AIRequest",
  aiRequestSchema
);
