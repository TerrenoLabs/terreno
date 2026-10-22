/**
 * `@terreno/syncdb/app` — app-shell utilities that sit beside the data layer:
 * the upgrade check (on the request client), RBAC helpers, the dev console log
 * bridge, and MCP tool discovery (on the shared auth provider).
 *
 * Needs `react`, `react-native`, and `expo-constants`; `useMCPTools` also needs
 * `@modelcontextprotocol/client` (all optional peer dependencies).
 */
export {type InstallDevConsoleLoggerOptions, installDevConsoleLogger} from "./devConsoleLogger";
export {
  type MCPToolInfo,
  type UseMCPToolsOptions,
  type UseMCPToolsResult,
  useMCPTools,
} from "./mcpTools";
export {
  ADMIN_PAGE_ACTION,
  ADMIN_PAGE_PERMISSION,
  ADMIN_PAGE_RESOURCE,
  canOpenAdminPage,
  hasPermission,
  type PermissionRequest,
  type PermissionSet,
} from "./permissions";
export {
  type UseUpgradeCheckOptions,
  type UseUpgradeCheckResult,
  useUpgradeCheck,
  type VersionCheckResponse,
} from "./upgradeCheck";
