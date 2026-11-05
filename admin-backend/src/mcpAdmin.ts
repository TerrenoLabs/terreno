import {
  ADMIN_MODEL_ACCESS,
  McpOAuthClient,
  McpOAuthToken,
  McpRequestLog,
  McpServiceToken,
  McpToolSetting,
  type ScriptRunner,
} from "@terreno/api";
import mongoose from "mongoose";

import type {AdminModelConfig, AdminScriptConfig} from "./adminApp";

/**
 * RBAC statements for the MCP admin screens. Spread into `createAccess({statements})` when
 * `AdminApp` has `accessControl`; without it the screens use `IsAdmin`.
 */
export const mcpAdminStatements = {
  adminMcpOAuthClient: ADMIN_MODEL_ACCESS,
  adminMcpOAuthConnection: ADMIN_MODEL_ACCESS,
  adminMcpRequestLog: ADMIN_MODEL_ACCESS,
  adminMcpServiceToken: ADMIN_MODEL_ACCESS,
  adminMcpTool: ADMIN_MODEL_ACCESS,
} as const;

/** Sidebar group the MCP screens share. */
export const MCP_ADMIN_GROUP = "MCP";

export interface McpAdminModelsOptions {
  /** Sidebar group. Default `"MCP"`. */
  group?: string;
  /**
   * Include the request log screen. Match `TerrenoApp`'s `mcpRequestLog`: the screen is empty
   * without it. Default false, like the server option.
   */
  requestLog?: boolean;
  /**
   * Include the tool registry screen. Match `TerrenoApp`'s `mcpToolSettings`: without it the
   * server ignores the switches. Default false, like the server option.
   */
  toolSettings?: boolean;
}

/**
 * Admin screens for a Terreno MCP server: service tokens, OAuth clients, OAuth connections
 * (token families), the request log, and the tool registry. Secret hashes are never listed, and
 * "delete" on a token or connection revokes it instead of removing the row.
 */
export const mcpAdminModels = (options: McpAdminModelsOptions = {}): AdminModelConfig[] => {
  const group = options.group ?? MCP_ADMIN_GROUP;
  const models: AdminModelConfig[] = [
    {
      adminAccess: {resource: "adminMcpServiceToken"},
      displayName: "MCP service tokens",
      group,
      hiddenFields: ["tokenHash"],
      listFields: [
        "name",
        "tokenPrefix",
        "userId",
        "lastUsedAt",
        "expiresAt",
        "revokedAt",
        "created",
      ],
      model: McpServiceToken,
      permissions: {create: false, delete: true, update: false},
      routePath: "/mcp-service-tokens",
      searchFields: ["name", "tokenPrefix"],
      sortableFields: ["name", "created", "lastUsedAt", "expiresAt", "revokedAt"],
    },
    {
      adminAccess: {resource: "adminMcpOAuthClient"},
      displayName: "MCP OAuth clients",
      group,
      hiddenFields: ["clientSecretHash"],
      listFields: [
        "clientName",
        "clientId",
        "redirectUris",
        "grantTypes",
        "tokenEndpointAuthMethod",
        "userId",
        "revokedAt",
        "created",
      ],
      model: McpOAuthClient,
      // Deleting a client removes its registration and revokes every token issued to it.
      permissions: {create: false, delete: true, update: false},
      routePath: "/mcp-oauth-clients",
      searchFields: ["clientName", "clientId"],
      sortableFields: ["clientName", "created", "revokedAt"],
    },
    {
      adminAccess: {resource: "adminMcpOAuthConnection"},
      displayName: "MCP OAuth connections",
      group,
      hiddenFields: ["accessTokenHash", "refreshTokenHash"],
      listFields: [
        "userId",
        "clientId",
        "familyId",
        "scope",
        "accessExpiresAt",
        "refreshExpiresAt",
        "rotatedAt",
        "revokedAt",
        "created",
      ],
      model: McpOAuthToken,
      // Each row is one access/refresh pair. Deleting any row revokes its whole connection.
      permissions: {create: false, delete: true, update: false},
      routePath: "/mcp-oauth-connections",
      searchFields: ["clientId", "familyId"],
      sortableFields: ["created", "accessExpiresAt", "refreshExpiresAt", "revokedAt"],
    },
  ];
  if (options.requestLog === true) {
    models.push({
      adminAccess: {resource: "adminMcpRequestLog"},
      defaultSort: "-created",
      displayName: "MCP request log",
      group,
      listFields: [
        "created",
        "toolName",
        "outcome",
        "durationMs",
        "userId",
        "credential",
        "oauthClientId",
        "serviceTokenId",
        "errorName",
      ],
      model: McpRequestLog,
      permissions: {create: false, delete: false, update: false},
      routePath: "/mcp-request-log",
      searchFields: ["toolName", "oauthClientId", "errorName"],
      sortableFields: ["created", "toolName", "durationMs", "outcome"],
    });
  }
  if (options.toolSettings === true) {
    models.push({
      adminAccess: {resource: "adminMcpTool"},
      defaultSort: "name",
      displayName: "MCP tools",
      group,
      listFields: ["name", "enabled", "source", "registered", "lastRegisteredAt"],
      model: McpToolSetting,
      permissions: {create: false, delete: false, update: true},
      readonlyFields: ["name", "source", "registered", "description", "lastRegisteredAt"],
      routePath: "/mcp-tools",
      searchFields: ["name", "description"],
      sortableFields: ["name", "enabled", "source", "lastRegisteredAt"],
    });
  }
  return models;
};

const SIGN_OUT_SCRIPT_NAME = "mcp-sign-out-everywhere";
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** Resolve the `user` argument (an id or an email) to a user id. */
const resolveUserId = async (value: string): Promise<mongoose.Types.ObjectId | undefined> => {
  // Only a 24-hex-character string is an id. isValidObjectId also accepts any 12-character
  // string, which would read a short email like "ab@gmail.com" as an id.
  if (OBJECT_ID_HEX.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  const userModel = mongoose.models.User;
  if (!userModel) {
    return undefined;
  }
  const email = value.trim();
  const users = await userModel
    .find({email: {$in: [...new Set([email, email.toLowerCase()])]}})
    .limit(2)
    .select({_id: 1})
    .lean<Array<{_id: mongoose.Types.ObjectId}>>();
  return users.length === 1 ? users[0]._id : undefined;
};

/**
 * Revoke every MCP credential a user holds: OAuth connections and service tokens. Dry run counts
 * what would be revoked.
 */
export const mcpSignOutEverywhere: ScriptRunner = async (wetRun, ctx) => {
  const value = ctx?.args.getString("user");
  if (typeof value !== "string" || value.trim().length === 0) {
    return {results: ["Pass --user <user id or email>."], success: false};
  }
  const userId = await resolveUserId(value);
  if (!userId) {
    return {results: [`No single user matches "${value}".`], success: false};
  }
  if (!wetRun) {
    const families = await McpOAuthToken.distinct("familyId", {
      revokedAt: {$exists: false},
      userId,
    });
    const tokens = await McpServiceToken.countDocuments({revokedAt: {$exists: false}, userId});
    return {
      results: [
        `Would revoke ${families.length} OAuth connection(s) and ${tokens} service token(s) for user ${String(userId)}.`,
      ],
      success: true,
    };
  }
  const families = await McpOAuthToken.revokeAllForUser(userId);
  const tokens = await McpServiceToken.revokeAllForUser(userId);
  await ctx?.addLog("info", `Revoked MCP credentials for user ${String(userId)}`);
  return {
    results: [
      `Revoked ${families} OAuth connection(s) and ${tokens} service token(s) for user ${String(userId)}.`,
    ],
    success: true,
  };
};

/** Admin scripts for MCP operators. Pass to `AdminApp({scripts})`. */
export const mcpAdminScripts = (): AdminScriptConfig[] => [
  {
    args: [
      {
        description: "User id or email whose MCP credentials to revoke",
        example: "someone@example.com",
        name: "user",
        required: true,
      },
    ],
    description:
      "Revoke every MCP OAuth connection and service token a user holds. Clients must reconnect.",
    name: SIGN_OUT_SCRIPT_NAME,
    runner: mcpSignOutEverywhere,
  },
];
