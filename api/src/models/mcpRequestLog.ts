import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {McpRequestLogDocument, McpRequestLogModel} from "../types/mcpAdmin";

/**
 * One row per MCP tool call when `mcpRequestLog` is on. Metadata only: tool arguments, results,
 * and error messages are never stored. Rows expire at `expiresAt`.
 */
const mcpRequestLogSchema = new mongoose.Schema<McpRequestLogDocument, McpRequestLogModel>(
  {
    credential: {
      description: "Credential type that authenticated the call",
      enum: ["jwt", "better-auth-session", "mcp-service-token", "oauth"],
      type: String,
    },
    durationMs: {
      description: "Time the tool handler took, in milliseconds",
      required: true,
      type: Number,
    },
    errorName: {
      description: "Error class name when the tool threw; never the error message",
      type: String,
    },
    expiresAt: {
      description: "When this log row is removed",
      required: true,
      type: Date,
    },
    oauthClientId: {
      description: "OAuth client id when the call used an MCP OAuth access token",
      index: true,
      type: String,
    },
    oauthFamilyId: {
      description: "OAuth token family (one approved connection) when the call used OAuth",
      type: String,
    },
    outcome: {
      description: "ok, tool_error (the tool returned isError), or exception (the tool threw)",
      enum: ["ok", "tool_error", "exception"],
      required: true,
      type: String,
    },
    serviceTokenId: {
      description: "Service token used for the call, when the credential was a service token",
      index: true,
      ref: "TerrenoMcpServiceToken",
      type: mongoose.Schema.Types.ObjectId,
    },
    toolName: {
      description: "Name of the MCP tool that was called",
      index: true,
      required: true,
      type: String,
    },
    userId: {
      description: "User the call acted as",
      index: true,
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpRequestLogSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});
mcpRequestLogSchema.index({created: -1});

mcpRequestLogSchema.plugin(createdUpdatedPlugin);
mcpRequestLogSchema.plugin(findOneOrNone);
mcpRequestLogSchema.plugin(findExactlyOne);

export const McpRequestLog =
  (mongoose.models.TerrenoMcpRequestLog as McpRequestLogModel | undefined) ??
  mongoose.model<McpRequestLogDocument, McpRequestLogModel>(
    "TerrenoMcpRequestLog",
    mcpRequestLogSchema,
    "mcprequestlogs"
  );
