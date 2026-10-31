import type {AdminModelConfig} from "@terreno/admin-backend";
import {McpServiceToken} from "@terreno/api";

/**
 * Admin changelist for hashed MCP service tokens. Create/update are off; delete
 * revokes (`revokedAt`) instead of removing the row. `tokenHash` stays hidden.
 */
export const mcpServiceTokenAdminModel: AdminModelConfig = {
  adminAccess: {},
  displayName: "MCP service tokens",
  group: "Platform",
  hiddenFields: ["tokenHash"],
  listFields: ["name", "tokenPrefix", "userId", "lastUsedAt", "expiresAt", "revokedAt", "created"],
  // String `_id` (synced) models do not fit admin-backend's ObjectId-keyed Model type.
  model: McpServiceToken as unknown as AdminModelConfig["model"],
  permissions: {create: false, delete: true, update: false},
  routePath: "/mcp-service-tokens",
  searchFields: ["name", "tokenPrefix"],
  sortableFields: ["name", "created", "lastUsedAt", "expiresAt", "revokedAt"],
};
