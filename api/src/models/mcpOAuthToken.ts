import {createHash, randomBytes, randomUUID} from "node:crypto";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {
  McpOAuthTokenDocument,
  McpOAuthTokenIssueOptions,
  McpOAuthTokenModel,
} from "../types/mcpOAuth";

/** Access tokens carry a prefix distinct from `mcp_` service tokens so `/mcp` can route them. */
export const MCP_OAUTH_ACCESS_TOKEN_PREFIX = "mcpat_";
const MCP_OAUTH_REFRESH_TOKEN_PREFIX = "mcprt_";
const MCP_OAUTH_TOKEN_RANDOM_BYTES = 32;

/** Codes, tokens, and request ids are stored only as SHA-256 hashes. */
export const hashMcpOAuthSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

export const generateMcpOAuthSecret = (prefix = ""): string =>
  `${prefix}${randomBytes(MCP_OAUTH_TOKEN_RANDOM_BYTES).toString("base64url")}`;

const mcpOAuthTokenSchema = new mongoose.Schema<McpOAuthTokenDocument, McpOAuthTokenModel>(
  {
    accessExpiresAt: {
      description: "When the access token stops authenticating MCP requests",
      required: true,
      type: Date,
    },
    accessTokenHash: {
      description: "SHA-256 hash of the opaque access token",
      required: true,
      type: String,
      unique: true,
    },
    clientId: {
      description: "OAuth client the tokens were issued to",
      required: true,
      type: String,
    },
    familyId: {
      description: "Rotation chain id shared by every pair issued from one authorization",
      index: true,
      required: true,
      type: String,
    },
    refreshExpiresAt: {
      description: "When the refresh token stops being exchangeable; the document is removed then",
      required: true,
      type: Date,
    },
    refreshTokenHash: {
      description: "SHA-256 hash of the opaque refresh token",
      required: true,
      type: String,
      unique: true,
    },
    resource: {
      description: "RFC 8707 resource the tokens are bound to",
      type: String,
    },
    reuseDetectedAt: {
      description: "When this refresh token was presented again after rotation",
      type: Date,
    },
    revokedAt: {
      description: "When the pair was revoked; unset while it remains active",
      type: Date,
    },
    rotatedAt: {
      description: "When the refresh token was exchanged for a new pair",
      type: Date,
    },
    scope: {
      description: "Space-separated scopes granted",
      type: String,
    },
    userId: {
      description: "The user the tokens act as",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpOAuthTokenSchema.index({refreshExpiresAt: 1}, {expireAfterSeconds: 0});

mcpOAuthTokenSchema.plugin(createdUpdatedPlugin);
mcpOAuthTokenSchema.plugin(findOneOrNone);
mcpOAuthTokenSchema.plugin(findExactlyOne);

mcpOAuthTokenSchema.statics = {
  ...mcpOAuthTokenSchema.statics,
  async issue(
    this: McpOAuthTokenModel,
    options: McpOAuthTokenIssueOptions
  ): Promise<{accessToken: string; mcpOAuthToken: McpOAuthTokenDocument; refreshToken: string}> {
    const accessToken = generateMcpOAuthSecret(MCP_OAUTH_ACCESS_TOKEN_PREFIX);
    const refreshToken = generateMcpOAuthSecret(MCP_OAUTH_REFRESH_TOKEN_PREFIX);
    const now = DateTime.now();
    const mcpOAuthToken = await this.create({
      accessExpiresAt: now.plus({seconds: options.accessTokenTtlSeconds}).toJSDate(),
      accessTokenHash: hashMcpOAuthSecret(accessToken),
      clientId: options.clientId,
      familyId: options.familyId ?? randomUUID(),
      refreshExpiresAt: now.plus({seconds: options.refreshTokenTtlSeconds}).toJSDate(),
      refreshTokenHash: hashMcpOAuthSecret(refreshToken),
      resource: options.resource,
      scope: options.scope,
      userId: options.userId,
    });
    return {accessToken, mcpOAuthToken, refreshToken};
  },
  async revokeFamily(this: McpOAuthTokenModel, familyId: string): Promise<void> {
    await this.updateMany(
      {familyId, revokedAt: {$exists: false}},
      {$set: {revokedAt: DateTime.now().toJSDate()}}
    );
  },
  async verifyAccessToken(
    this: McpOAuthTokenModel,
    token: string
  ): Promise<McpOAuthTokenDocument | null> {
    if (!token.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)) {
      return null;
    }
    return this.findOneOrNone({
      accessExpiresAt: {$gt: DateTime.now().toJSDate()},
      accessTokenHash: hashMcpOAuthSecret(token),
      revokedAt: {$exists: false},
    });
  },
};

export const McpOAuthToken =
  (mongoose.models.TerrenoMcpOAuthToken as McpOAuthTokenModel | undefined) ??
  mongoose.model<McpOAuthTokenDocument, McpOAuthTokenModel>(
    "TerrenoMcpOAuthToken",
    mcpOAuthTokenSchema,
    "mcpoauthtokens"
  );
