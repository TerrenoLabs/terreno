/**
 * `@terreno/syncdb/app` — app-shell utilities that sit beside the data layer:
 * the upgrade check (on the request client), RBAC helpers, and the dev console log
 * bridge.
 *
 * Needs `react`, `react-native`, and `expo-constants` (optional peer dependencies).
 * MCP tool discovery (`useMCPTools`) lives in `@terreno/syncdb/mcp`, because it imports
 * the optional `@modelcontextprotocol/client` peer at the top level: exporting it here
 * would break every app that imports this entry point without that package installed.
 */
export {type InstallDevConsoleLoggerOptions, installDevConsoleLogger} from "./devConsoleLogger";
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
