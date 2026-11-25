import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {McpOAuthConsentAttemptDocument, McpOAuthConsentAttemptModel} from "../types/mcpOAuth";

const mcpOAuthConsentAttemptSchema = new mongoose.Schema<
  McpOAuthConsentAttemptDocument,
  McpOAuthConsentAttemptModel
>(
  {
    expiresAt: {
      description: "When the record is removed: the end of the lockout window or of the TOTP step",
      required: true,
      type: Date,
    },
    key: {
      description: "Normalized email for a failure; Better Auth user id for a used TOTP step",
      required: true,
      type: String,
    },
    kind: {
      description: "failure (a refused approval) or totpStep (a TOTP step already used)",
      enum: ["failure", "totpStep"],
      required: true,
      type: String,
    },
    step: {
      description: "The RFC 6238 time step a used code matched",
      type: Number,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpOAuthConsentAttemptSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});
mcpOAuthConsentAttemptSchema.index({created: 1, key: 1, kind: 1});
// The insert is the replay check: a step can be recorded once per user.
mcpOAuthConsentAttemptSchema.index(
  {key: 1, step: 1},
  {partialFilterExpression: {kind: "totpStep"}, unique: true}
);

mcpOAuthConsentAttemptSchema.plugin(createdUpdatedPlugin);
mcpOAuthConsentAttemptSchema.plugin(findOneOrNone);
mcpOAuthConsentAttemptSchema.plugin(findExactlyOne);

/** Built-in consent page lockout failures and used TOTP steps, expired by TTL. */
export const McpOAuthConsentAttempt =
  (mongoose.models.TerrenoMcpOAuthConsentAttempt as McpOAuthConsentAttemptModel | undefined) ??
  mongoose.model<McpOAuthConsentAttemptDocument, McpOAuthConsentAttemptModel>(
    "TerrenoMcpOAuthConsentAttempt",
    mcpOAuthConsentAttemptSchema,
    "mcpoauthconsentattempts"
  );
