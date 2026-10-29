import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {McpOAuthClientDocument, McpOAuthClientModel} from "../types/mcpOAuth";

const mcpOAuthClientSchema = new mongoose.Schema<McpOAuthClientDocument, McpOAuthClientModel>(
  {
    clientId: {
      description: "Public OAuth client identifier issued by dynamic client registration",
      required: true,
      type: String,
      unique: true,
    },
    clientName: {
      description: "Human-readable client name shown on the consent screen",
      trim: true,
      type: String,
    },
    grantTypes: {
      description: "OAuth grant types the client may use",
      type: [String],
    },
    redirectUris: {
      description:
        "Registered redirect URIs. Loopback hosts (localhost, 127.0.0.1, [::1]) match any port; every other URI must match exactly",
      type: [String],
    },
    responseTypes: {
      description: "OAuth response types the client may request",
      type: [String],
    },
    scope: {
      description: "Space-separated scopes the client registered for",
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpOAuthClientSchema.plugin(createdUpdatedPlugin);
mcpOAuthClientSchema.plugin(findOneOrNone);
mcpOAuthClientSchema.plugin(findExactlyOne);

export const McpOAuthClient =
  (mongoose.models.TerrenoMcpOAuthClient as McpOAuthClientModel | undefined) ??
  mongoose.model<McpOAuthClientDocument, McpOAuthClientModel>(
    "TerrenoMcpOAuthClient",
    mcpOAuthClientSchema,
    "mcpoauthclients"
  );
