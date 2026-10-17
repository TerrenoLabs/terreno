import type mongoose from "mongoose";
import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "../plugins";

/** A client registered through dynamic client registration (RFC 7591). Public clients only. */
export interface McpOAuthClientDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  clientId: string;
  clientName?: string;
  created: Date;
  grantTypes: string[];
  redirectUris: string[];
  responseTypes: string[];
  scope?: string;
  updated: Date;
}

interface McpOAuthClientStatics
  extends FindExactlyOnePlugin<McpOAuthClientDocument>,
    FindOneOrNonePlugin<McpOAuthClientDocument> {}

export interface McpOAuthClientModel
  extends mongoose.Model<McpOAuthClientDocument>,
    McpOAuthClientStatics {}

/**
 * Lifecycle of one authorization request: `pending` until the signed-in user decides, then
 * `approved` (a code is outstanding) or `denied`, then `used` once the code is exchanged.
 */
export type McpOAuthAuthorizationStatus = "pending" | "approved" | "denied" | "used";

export interface McpOAuthAuthorizationDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  clientId: string;
  codeChallenge: string;
  codeExpiresAt?: Date;
  codeHash?: string;
  created: Date;
  expiresAt: Date;
  familyId?: string;
  redirectUri: string;
  requestId: string;
  resource?: string;
  scope?: string;
  state?: string;
  status: McpOAuthAuthorizationStatus;
  updated: Date;
  usedAt?: Date;
  userId?: mongoose.Types.ObjectId;
}

interface McpOAuthAuthorizationStatics
  extends FindExactlyOnePlugin<McpOAuthAuthorizationDocument>,
    FindOneOrNonePlugin<McpOAuthAuthorizationDocument> {}

export interface McpOAuthAuthorizationModel
  extends mongoose.Model<McpOAuthAuthorizationDocument>,
    McpOAuthAuthorizationStatics {}

/** One issued access/refresh token pair. Rotation chains pairs together by `familyId`. */
export interface McpOAuthTokenDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  accessExpiresAt: Date;
  accessTokenHash: string;
  clientId: string;
  created: Date;
  familyId: string;
  refreshExpiresAt: Date;
  refreshTokenHash: string;
  resource?: string;
  revokedAt?: Date;
  rotatedAt?: Date;
  scope?: string;
  updated: Date;
  userId: mongoose.Types.ObjectId;
}

export interface McpOAuthTokenIssueOptions {
  accessTokenTtlSeconds: number;
  clientId: string;
  familyId?: string;
  refreshTokenTtlSeconds: number;
  resource?: string;
  scope?: string;
  userId: mongoose.Types.ObjectId;
}

interface McpOAuthTokenStatics
  extends FindExactlyOnePlugin<McpOAuthTokenDocument>,
    FindOneOrNonePlugin<McpOAuthTokenDocument> {
  issue: (
    this: McpOAuthTokenModel,
    options: McpOAuthTokenIssueOptions
  ) => Promise<{
    accessToken: string;
    mcpOAuthToken: McpOAuthTokenDocument;
    refreshToken: string;
  }>;
  revokeFamily: (this: McpOAuthTokenModel, familyId: string) => Promise<void>;
  verifyAccessToken: (
    this: McpOAuthTokenModel,
    token: string
  ) => Promise<McpOAuthTokenDocument | null>;
}

export interface McpOAuthTokenModel
  extends mongoose.Model<McpOAuthTokenDocument>,
    McpOAuthTokenStatics {}
