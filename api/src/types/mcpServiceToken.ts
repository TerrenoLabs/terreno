import type mongoose from "mongoose";
import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "../plugins";

export interface McpServiceTokenIssueOptions {
  expiresAt?: Date;
  name: string;
}

interface McpServiceTokenMethods {
  deleteOne: (this: McpServiceTokenDocument) => Promise<McpServiceTokenDocument>;
}

export interface McpServiceTokenStatics
  extends FindExactlyOnePlugin<McpServiceTokenDocument>,
    FindOneOrNonePlugin<McpServiceTokenDocument> {
  countActiveForUser: (
    this: McpServiceTokenModel,
    userId: mongoose.Types.ObjectId | string
  ) => Promise<number>;
  issueFor: (
    this: McpServiceTokenModel,
    user: {_id: {toString(): string}; tokenEpoch?: number},
    options: McpServiceTokenIssueOptions
  ) => Promise<{mcpServiceToken: McpServiceTokenDocument; token: string}>;
  revokeOutdatedForUser: (
    this: McpServiceTokenModel,
    user: {_id: {toString(): string}; tokenEpoch?: number}
  ) => Promise<void>;
  revokeForUser: (
    this: McpServiceTokenModel,
    user: {_id: {toString(): string}},
    tokenId: string
  ) => Promise<McpServiceTokenDocument | null>;
  verify: (this: McpServiceTokenModel, token: string) => Promise<McpServiceTokenDocument | null>;
}

export interface McpServiceTokenModel
  extends mongoose.Model<McpServiceTokenDocument, object, McpServiceTokenMethods>,
    McpServiceTokenStatics {}

export interface McpServiceTokenDocument extends mongoose.Document<string> {
  /** UUID for new rows; ObjectId hex for rows migrated by mcp-service-token-string-ids. */
  _id: string;
  created: Date;
  /** Always false: a delete revokes the token instead of tombstoning it. */
  deleted: boolean;
  expiresAt?: Date;
  lastUsedAt?: Date;
  name: string;
  revokedAt?: Date;
  tokenEpoch?: number;
  tokenHash: string;
  tokenPrefix: string;
  updated: Date;
  userId: mongoose.Types.ObjectId;
}
