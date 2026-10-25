import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {McpOAuthAuthorizationDocument, McpOAuthAuthorizationModel} from "../types/mcpOAuth";

const mcpOAuthAuthorizationSchema = new mongoose.Schema<
  McpOAuthAuthorizationDocument,
  McpOAuthAuthorizationModel
>(
  {
    clientId: {
      description: "OAuth client that started this authorization request",
      required: true,
      type: String,
    },
    codeChallenge: {
      description: "PKCE S256 code challenge sent with the authorization request",
      required: true,
      type: String,
    },
    codeExpiresAt: {
      description: "When the issued authorization code stops being exchangeable",
      type: Date,
    },
    codeHash: {
      description: "SHA-256 hash of the issued authorization code",
      index: {sparse: true, unique: true},
      type: String,
    },
    expiresAt: {
      description: "When the pending request expires and the document is removed",
      required: true,
      type: Date,
    },
    familyId: {
      description: "Token family issued from this code, revoked if the code is replayed",
      type: String,
    },
    redirectUri: {
      description: "Registered redirect URI the code is delivered to",
      required: true,
      type: String,
    },
    replayedAt: {
      description: "When the authorization code was presented again after being exchanged",
      type: Date,
    },
    requestId: {
      description: "Opaque id handed to the consent screen to identify this request",
      required: true,
      type: String,
      unique: true,
    },
    resource: {
      description: "RFC 8707 resource indicator the client asked for",
      type: String,
    },
    scope: {
      description: "Space-separated scopes requested by the client",
      type: String,
    },
    state: {
      description: "Opaque client state echoed back on the redirect",
      type: String,
    },
    status: {
      default: "pending",
      description: "pending, approved (code outstanding), denied, or used (code exchanged)",
      enum: ["pending", "approved", "denied", "used"],
      type: String,
    },
    usedAt: {
      description: "When the authorization code was exchanged",
      type: Date,
    },
    userId: {
      description: "The user who approved or denied the request",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpOAuthAuthorizationSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

mcpOAuthAuthorizationSchema.plugin(createdUpdatedPlugin);
mcpOAuthAuthorizationSchema.plugin(findOneOrNone);
mcpOAuthAuthorizationSchema.plugin(findExactlyOne);

export const McpOAuthAuthorization =
  (mongoose.models.TerrenoMcpOAuthAuthorization as McpOAuthAuthorizationModel | undefined) ??
  mongoose.model<McpOAuthAuthorizationDocument, McpOAuthAuthorizationModel>(
    "TerrenoMcpOAuthAuthorization",
    mcpOAuthAuthorizationSchema,
    "mcpoauthauthorizations"
  );
