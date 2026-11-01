import {createHash, randomBytes, randomUUID} from "node:crypto";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {
  McpOAuthTokenDocument,
  McpOAuthTokenIssueOptions,
  McpOAuthTokenModel,
} from "../types/mcpOAuth";
import {McpOAuthRevokedFamily} from "./mcpOAuthRevokedFamily";

/** Access tokens carry a prefix distinct from `mcp_` service tokens so `/mcp` can route them. */
export const MCP_OAUTH_ACCESS_TOKEN_PREFIX = "mcpat_";
const MCP_OAUTH_REFRESH_TOKEN_PREFIX = "mcprt_";
const MCP_OAUTH_TOKEN_RANDOM_BYTES = 32;
// A tombstone outlives in-flight requests even when the family has no unexpired refresh token.
const MIN_REVOKED_FAMILY_RETENTION_SECONDS = 60 * 60;

/** Thrown by `McpOAuthToken.issue` for a family that was revoked. Answer it as `invalid_grant`. */
export class McpOAuthFamilyRevokedError extends Error {
  readonly familyId: string;

  constructor(familyId: string) {
    super("The token family was revoked");
    this.familyId = familyId;
    this.name = "McpOAuthFamilyRevokedError";
  }
}

const isFamilyRevoked = async (familyId: string): Promise<boolean> =>
  Boolean(await McpOAuthRevokedFamily.exists({familyId}));

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
    hasRefreshToken: {
      description:
        "False when this document is an access-only client_credentials token. The refresh hash is then of a discarded secret and cannot be exchanged",
      type: Boolean,
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
    tokenEpoch: {
      description:
        "The user's tokenEpoch when the grant was approved; the pair stops working after it changes",
      type: Number,
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
  ): Promise<{accessToken: string; mcpOAuthToken: McpOAuthTokenDocument; refreshToken?: string}> {
    const familyId = options.familyId ?? randomUUID();
    if (await isFamilyRevoked(familyId)) {
      throw new McpOAuthFamilyRevokedError(familyId);
    }
    const includeRefreshToken = options.includeRefreshToken !== false;
    const accessToken = generateMcpOAuthSecret(MCP_OAUTH_ACCESS_TOKEN_PREFIX);
    // Access-only grants still store a unique hash so the refreshTokenHash index stays unique.
    // The preimage is discarded, and hasRefreshToken false makes it unusable for refresh.
    const refreshSecret = includeRefreshToken
      ? generateMcpOAuthSecret(MCP_OAUTH_REFRESH_TOKEN_PREFIX)
      : generateMcpOAuthSecret("discarded_");
    const now = DateTime.now();
    const refreshTtlSeconds = includeRefreshToken
      ? options.refreshTokenTtlSeconds
      : options.accessTokenTtlSeconds;
    const mcpOAuthToken = await this.create({
      accessExpiresAt: now.plus({seconds: options.accessTokenTtlSeconds}).toJSDate(),
      accessTokenHash: hashMcpOAuthSecret(accessToken),
      clientId: options.clientId,
      familyId,
      hasRefreshToken: includeRefreshToken,
      refreshExpiresAt: now.plus({seconds: refreshTtlSeconds}).toJSDate(),
      refreshTokenHash: hashMcpOAuthSecret(refreshSecret),
      resource: options.resource,
      scope: options.scope,
      tokenEpoch: options.tokenEpoch ?? 0,
      userId: options.userId,
    });
    // revokeFamily writes the tombstone before it revokes pairs, so a revoke that raced this
    // create has either revoked the new pair already or is visible here.
    if (await isFamilyRevoked(familyId)) {
      await this.updateOne(
        {_id: mcpOAuthToken._id, revokedAt: {$exists: false}},
        {$set: {revokedAt: DateTime.now().toJSDate()}}
      );
      throw new McpOAuthFamilyRevokedError(familyId);
    }
    return {
      accessToken,
      mcpOAuthToken,
      refreshToken: includeRefreshToken ? refreshSecret : undefined,
    };
  },
  async revokeClient(this: McpOAuthTokenModel, clientId: string): Promise<void> {
    const tokens = await this.find({clientId, revokedAt: {$exists: false}}).select({familyId: 1});
    const familyIds = new Set(tokens.map((token) => token.familyId));
    for (const familyId of familyIds) {
      await this.revokeFamily(familyId);
    }
  },
  async revokeFamily(this: McpOAuthTokenModel, familyId: string): Promise<void> {
    const now = DateTime.now();
    const [latest] = await this.find({familyId})
      .sort({refreshExpiresAt: -1})
      .limit(1)
      .select({refreshExpiresAt: 1});
    const minimumRetention = now.plus({seconds: MIN_REVOKED_FAMILY_RETENTION_SECONDS});
    const retainUntil = latest
      ? DateTime.max(minimumRetention, DateTime.fromJSDate(latest.refreshExpiresAt))
      : minimumRetention;
    // The tombstone goes first: issue checks it again after creating a pair.
    await McpOAuthRevokedFamily.updateOne(
      {familyId},
      {
        $max: {expiresAt: retainUntil.toJSDate()},
        $setOnInsert: {revokedAt: now.toJSDate()},
      },
      {upsert: true}
    );
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
