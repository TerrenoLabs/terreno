import {createHash, randomBytes} from "node:crypto";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, findOneOrNoneFor} from "../plugins";
import type {McpServiceTokenDocument, McpServiceTokenModel} from "../types/mcpServiceToken";

export type {
  McpServiceTokenDocument,
  McpServiceTokenIssueOptions,
  McpServiceTokenModel,
  McpServiceTokenStatics,
} from "../types/mcpServiceToken";

const MCP_SERVICE_TOKEN_PREFIX = "mcp_";
const MCP_SERVICE_TOKEN_RANDOM_BYTES = 32;
const MCP_SERVICE_TOKEN_DISPLAY_LENGTH = 8;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const mcpServiceTokenSchema = new mongoose.Schema<McpServiceTokenDocument, McpServiceTokenModel>(
  {
    expiresAt: {
      description: "When this MCP service token expires; unset when it does not expire",
      type: Date,
    },
    lastUsedAt: {
      description: "When this MCP service token most recently authenticated an MCP request",
      type: Date,
    },
    name: {
      description: "User-provided label identifying the MCP service token",
      required: true,
      trim: true,
      type: String,
    },
    revokedAt: {
      description: "When this MCP service token was revoked; unset while it remains active",
      type: Date,
    },
    tokenHash: {
      description: "SHA-256 hash of the full MCP service token plaintext",
      required: true,
      type: String,
      unique: true,
    },
    tokenPrefix: {
      description: "First eight characters after mcp_ used to identify the token safely",
      required: true,
      type: String,
    },
    userId: {
      description: "The user this MCP service token acts as",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpServiceTokenSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});
mcpServiceTokenSchema.index({revokedAt: 1, userId: 1});

mcpServiceTokenSchema.plugin(createdUpdatedPlugin);
mcpServiceTokenSchema.plugin(findOneOrNone);
mcpServiceTokenSchema.plugin(findExactlyOne);

const revokeInsteadOfDelete = async (
  doc: McpServiceTokenDocument | null
): Promise<McpServiceTokenDocument | null> => {
  if (!doc) {
    return null;
  }
  if (!doc.revokedAt) {
    doc.set("revokedAt", DateTime.now().toJSDate());
    await doc.save();
  }
  return doc;
};

mcpServiceTokenSchema.methods = {
  ...mcpServiceTokenSchema.methods,
  async deleteOne(this: McpServiceTokenDocument): Promise<McpServiceTokenDocument> {
    const revoked = await revokeInsteadOfDelete(this);
    return revoked ?? this;
  },
};

mcpServiceTokenSchema.pre("deleteOne", {document: false, query: true}, async function () {
  const existing = await findOneOrNoneFor(this.model, this.getFilter());
  await revokeInsteadOfDelete(existing as McpServiceTokenDocument | null);
  this.setQuery({_id: {$exists: false}});
});

mcpServiceTokenSchema.statics = {
  ...mcpServiceTokenSchema.statics,
  async countActiveForUser(
    this: McpServiceTokenModel,
    userId: mongoose.Types.ObjectId
  ): Promise<number> {
    const now = DateTime.now().toJSDate();
    return this.countDocuments({
      $or: [{expiresAt: {$exists: false}}, {expiresAt: {$gt: now}}],
      revokedAt: {$exists: false},
      userId,
    });
  },
  async issueFor(
    this: McpServiceTokenModel,
    user: {_id: {toString(): string}},
    options: {expiresAt?: Date; name: string}
  ): Promise<{mcpServiceToken: McpServiceTokenDocument; token: string}> {
    const token = `${MCP_SERVICE_TOKEN_PREFIX}${randomBytes(MCP_SERVICE_TOKEN_RANDOM_BYTES).toString("hex")}`;
    const mcpServiceToken = await this.create({
      expiresAt: options.expiresAt,
      name: options.name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(
        MCP_SERVICE_TOKEN_PREFIX.length,
        MCP_SERVICE_TOKEN_PREFIX.length + MCP_SERVICE_TOKEN_DISPLAY_LENGTH
      ),
      userId: new mongoose.Types.ObjectId(String(user._id)),
    });
    return {mcpServiceToken, token};
  },
  async revokeForUser(
    this: McpServiceTokenModel,
    user: {_id: {toString(): string}},
    tokenId: mongoose.Types.ObjectId
  ): Promise<McpServiceTokenDocument | null> {
    return this.findOneAndUpdate(
      {
        _id: tokenId,
        revokedAt: {$exists: false},
        userId: new mongoose.Types.ObjectId(String(user._id)),
      },
      {$set: {revokedAt: DateTime.now().toJSDate()}},
      {returnDocument: "after"}
    );
  },
  async verify(this: McpServiceTokenModel, token: string): Promise<McpServiceTokenDocument | null> {
    const now = DateTime.now().toJSDate();
    return this.findOneOrNone({
      $or: [{expiresAt: {$exists: false}}, {expiresAt: {$gt: now}}],
      revokedAt: {$exists: false},
      tokenHash: hashToken(token),
    });
  },
};

export const McpServiceToken =
  (mongoose.models.TerrenoMcpServiceToken as McpServiceTokenModel | undefined) ??
  mongoose.model<McpServiceTokenDocument, McpServiceTokenModel>(
    "TerrenoMcpServiceToken",
    mcpServiceTokenSchema,
    "mcpservicetokens"
  );
