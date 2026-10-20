import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {McpOAuthRevokedFamilyDocument, McpOAuthRevokedFamilyModel} from "../types/mcpOAuth";

/**
 * Tombstone for a revoked token family. `McpOAuthToken.issue` refuses a family that has one, so
 * a request that won a rotation or code exchange before the revoke cannot add a live pair after.
 */
const mcpOAuthRevokedFamilySchema = new mongoose.Schema<
  McpOAuthRevokedFamilyDocument,
  McpOAuthRevokedFamilyModel
>(
  {
    expiresAt: {
      description: "When the tombstone is removed; set past the last refresh expiry in the family",
      required: true,
      type: Date,
    },
    familyId: {
      description: "Rotation chain id that was revoked",
      required: true,
      type: String,
      unique: true,
    },
    revokedAt: {
      description: "When the family was first revoked",
      required: true,
      type: Date,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpOAuthRevokedFamilySchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

mcpOAuthRevokedFamilySchema.plugin(createdUpdatedPlugin);
mcpOAuthRevokedFamilySchema.plugin(findOneOrNone);
mcpOAuthRevokedFamilySchema.plugin(findExactlyOne);

export const McpOAuthRevokedFamily =
  (mongoose.models.TerrenoMcpOAuthRevokedFamily as McpOAuthRevokedFamilyModel | undefined) ??
  mongoose.model<McpOAuthRevokedFamilyDocument, McpOAuthRevokedFamilyModel>(
    "TerrenoMcpOAuthRevokedFamily",
    mcpOAuthRevokedFamilySchema,
    "mcpoauthrevokedfamilies"
  );
