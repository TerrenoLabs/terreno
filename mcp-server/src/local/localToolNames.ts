/**
 * Every tool `terreno-mcp-local` serves, by name. It lives apart from the tool definitions so
 * other packages can check their coverage of the list without loading the handlers.
 * `localTools.test.ts` fails when this list and `localMcpTools` disagree.
 */
export const LOCAL_TOOL_NAMES = [
  "application_info",
  "database_schema",
  "database_query",
  "read_logs",
  "last_error",
  "get_syncdb_state",
  "syncdb_action",
  "syncdb_snapshot",
  "evaluate",
  "navigate",
  "dispatch_client_action",
  "read_local_storage",
  "write_local_storage",
  "list_dev_commands",
  "invoke_dev_command",
  "browser",
] as const;
