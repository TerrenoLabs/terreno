import {randomUUID} from "node:crypto";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {
  McpOAuthClientDocument,
  McpOAuthClientModel,
  McpOAuthConfidentialClientOptions,
} from "../types/mcpOAuth";
import {generateMcpOAuthSecret, hashMcpOAuthSecret, McpOAuthToken} from "./mcpOAuthToken";

const mcpOAuthClientSchema = new mongoose.Schema<McpOAuthClientDocument, McpOAuthClientModel>(
  {
    clientId: {
      description: "Public OAuth client identifier",
      required: true,
      type: String,
      unique: true,
    },
    clientName: {
      description: "Human-readable client name shown on the consent screen",
      trim: true,
      type: String,
    },
    clientSecretHash: {
      description: "SHA-256 hash of the confidential client secret. Unset for public clients",
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
    revokedAt: {
      description: "When the client was revoked. A revoked client cannot take new grants",
      type: Date,
    },
    scope: {
      description: "Space-separated scopes the client registered for",
      type: String,
    },
    tokenEndpointAuthMethod: {
      description:
        "How the client authenticates at the token endpoint. none is a public client; client_secret_basic and client_secret_post are confidential",
      enum: ["none", "client_secret_basic", "client_secret_post"],
      type: String,
    },
    userId: {
      description: "User a client_credentials token acts as",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpOAuthClientSchema.plugin(createdUpdatedPlugin);
mcpOAuthClientSchema.plugin(findOneOrNone);
mcpOAuthClientSchema.plugin(findExactlyOne);

const revokeTokensForClient = async (clientId: string | undefined): Promise<void> => {
  if (!clientId) {
    return;
  }
  await McpOAuthToken.revokeClient(clientId);
};

mcpOAuthClientSchema.pre("deleteOne", {document: true, query: false}, async function () {
  await revokeTokensForClient(this.clientId);
});

mcpOAuthClientSchema.pre("deleteOne", {document: false, query: true}, async function () {
  // deleteOne removes one document. A filter that matches several must not throw.
  const [existing] = await this.model.find(this.getFilter()).limit(1).select({clientId: 1});
  await revokeTokensForClient(existing?.clientId);
});

mcpOAuthClientSchema.pre("findOneAndDelete", async function () {
  const [existing] = await this.model.find(this.getFilter()).limit(1).select({clientId: 1});
  await revokeTokensForClient(existing?.clientId);
});

mcpOAuthClientSchema.pre("deleteMany", async function () {
  const clients = await this.model.find(this.getFilter()).select({clientId: 1});
  for (const client of clients) {
    await revokeTokensForClient(client.clientId);
  }
});

mcpOAuthClientSchema.statics = {
  ...mcpOAuthClientSchema.statics,
  async issueConfidential(
    this: McpOAuthClientModel,
    options: McpOAuthConfidentialClientOptions
  ): Promise<{client: McpOAuthClientDocument; clientSecret: string}> {
    const clientSecret = generateMcpOAuthSecret("mcpcs_");
    const client = await this.create({
      clientId: options.clientId ?? randomUUID(),
      clientName: options.clientName,
      clientSecretHash: hashMcpOAuthSecret(clientSecret),
      grantTypes: ["client_credentials"],
      redirectUris: [],
      responseTypes: [],
      scope: options.scope,
      tokenEndpointAuthMethod: options.tokenEndpointAuthMethod,
      userId: new mongoose.Types.ObjectId(String(options.userId)),
    });
    return {client, clientSecret};
  },
  async revoke(
    this: McpOAuthClientModel,
    clientId: string
  ): Promise<McpOAuthClientDocument | null> {
    await this.updateOne(
      {clientId, revokedAt: {$exists: false}},
      {$set: {revokedAt: DateTime.now().toJSDate()}}
    );
    await McpOAuthToken.revokeClient(clientId);
    return this.findOneOrNone({clientId});
  },
};

export const McpOAuthClient =
  (mongoose.models.TerrenoMcpOAuthClient as McpOAuthClientModel | undefined) ??
  mongoose.model<McpOAuthClientDocument, McpOAuthClientModel>(
    "TerrenoMcpOAuthClient",
    mcpOAuthClientSchema,
    "mcpoauthclients"
  );
