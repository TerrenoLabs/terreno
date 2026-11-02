---
category: Added
---

- `@terreno/api`: opt-in `mcpRequestLog` on `TerrenoApp` records one metadata-only `McpRequestLog` row per MCP tool call (tool, user, credential, service token or OAuth client, duration, outcome, error class; never arguments, results, or error text), expiring after `retentionDays` (default 30).
- `@terreno/api`: opt-in `mcpToolSettings` on `TerrenoApp` registers every MCP tool in `McpToolSetting` at startup; tools an admin switches off are hidden from `tools/list` and rejected by `tools/call`.
- `@terreno/api`: deleting an `McpOAuthToken` row revokes its whole connection (token family) and keeps the rows. New `McpOAuthToken.revokeAllForUser` and `McpServiceToken.revokeAllForUser`.
- `@terreno/admin-backend`: `mcpAdminModels()` adds MCP admin screens (service tokens, OAuth clients, OAuth connections, request log, tool switches), `mcpAdminStatements` for RBAC, and `mcpAdminScripts()` adds `mcp-sign-out-everywhere`. See [Manage MCP from the admin panel](docs/how-to/manage-mcp-in-admin.md).
- Docs: [Expose an MCP server safely](docs/how-to/expose-mcp-server-safely.md) (OAuth, service tokens, Cloudflare Tunnel, Access) and the `bootstrap-mcp-server` skill for a single-binary MCP server with the admin console embedded.
