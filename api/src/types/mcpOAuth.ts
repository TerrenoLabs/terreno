import type mongoose from "mongoose";
import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "../plugins";

export type McpOAuthTokenEndpointAuthMethod = "none" | "client_secret_basic" | "client_secret_post";

/** Options for `McpOAuthClient.issueConfidential`. The secret is returned once. */
export interface McpOAuthConfidentialClientOptions {
  clientId?: string;
  clientName: string;
  scope?: string;
  tokenEndpointAuthMethod: Exclude<McpOAuthTokenEndpointAuthMethod, "none">;
  userId: mongoose.Types.ObjectId | string;
}

/**
 * A public authorization-code client, or a confidential `client_credentials` client bound to a
 * user. Public clients leave `tokenEndpointAuthMethod` unset.
 */
export interface McpOAuthClientDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  clientId: string;
  clientName?: string;
  /** SHA-256 hash of the client secret. Set only for confidential clients. */
  clientSecretHash?: string;
  created: Date;
  grantTypes: string[];
  redirectUris: string[];
  responseTypes: string[];
  revokedAt?: Date;
  scope?: string;
  tokenEndpointAuthMethod?: McpOAuthTokenEndpointAuthMethod;
  updated: Date;
  /** User a `client_credentials` token acts as. */
  userId?: mongoose.Types.ObjectId;
}

interface McpOAuthClientStatics
  extends FindExactlyOnePlugin<McpOAuthClientDocument>,
    FindOneOrNonePlugin<McpOAuthClientDocument> {
  issueConfidential: (
    this: McpOAuthClientModel,
    options: McpOAuthConfidentialClientOptions
  ) => Promise<{client: McpOAuthClientDocument; clientSecret: string}>;
  /** Mark the client revoked and end every token it holds. */
  revoke: (this: McpOAuthClientModel, clientId: string) => Promise<McpOAuthClientDocument | null>;
}

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
  tokenEpoch?: number;
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

/** Tombstone written when a token family is revoked; blocks any later issue into it. */
export interface McpOAuthRevokedFamilyDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  created: Date;
  expiresAt: Date;
  familyId: string;
  revokedAt: Date;
  updated: Date;
}

interface McpOAuthRevokedFamilyStatics
  extends FindExactlyOnePlugin<McpOAuthRevokedFamilyDocument>,
    FindOneOrNonePlugin<McpOAuthRevokedFamilyDocument> {}

export interface McpOAuthRevokedFamilyModel
  extends mongoose.Model<McpOAuthRevokedFamilyDocument>,
    McpOAuthRevokedFamilyStatics {}

/** One issued access/refresh token pair. Rotation chains pairs together by `familyId`. */
export interface McpOAuthTokenDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  accessExpiresAt: Date;
  accessTokenHash: string;
  clientId: string;
  created: Date;
  familyId: string;
  /**
   * False for an access-only `client_credentials` token. The stored refresh hash is then of a
   * discarded secret and must not be exchanged.
   */
  hasRefreshToken?: boolean;
  refreshExpiresAt: Date;
  refreshTokenHash: string;
  resource?: string;
  revokedAt?: Date;
  rotatedAt?: Date;
  scope?: string;
  tokenEpoch?: number;
  updated: Date;
  userId: mongoose.Types.ObjectId;
}

export interface McpOAuthTokenIssueOptions {
  accessTokenTtlSeconds: number;
  clientId: string;
  familyId?: string;
  /** When false, issue an access token only and do not return a refresh token. Default true. */
  includeRefreshToken?: boolean;
  refreshTokenTtlSeconds: number;
  resource?: string;
  scope?: string;
  /** The user's tokenEpoch when the grant was approved (default 0); a later bump ends the family. */
  tokenEpoch?: number;
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
    refreshToken?: string;
  }>;
  /** Revoke every family issued to this client. */
  revokeClient: (this: McpOAuthTokenModel, clientId: string) => Promise<void>;
  revokeFamily: (this: McpOAuthTokenModel, familyId: string) => Promise<void>;
  verifyAccessToken: (
    this: McpOAuthTokenModel,
    token: string
  ) => Promise<McpOAuthTokenDocument | null>;
}

export interface McpOAuthTokenModel
  extends mongoose.Model<McpOAuthTokenDocument>,
    McpOAuthTokenStatics {}
