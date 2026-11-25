## Properties

### betterAuth?

> `optional` **betterAuth?**: `Auth`\<`BetterAuthOptions`\>

***

### mcpOAuth?

> `optional` **mcpOAuth?**: [`ResolvedMcpOAuthOptions`](ResolvedMcpOAuthOptions.md)

Resolved `mcpOAuth` options. When set, `/mcp` accepts OAuth access tokens and answers a
request without valid credentials with a 401 RFC 9728 challenge.

***

### mcpServiceTokens?

> `optional` **mcpServiceTokens?**: `boolean`

***

### requestLog?

> `optional` **requestLog?**: [`ResolvedMcpRequestLogOptions`](ResolvedMcpRequestLogOptions.md)

When set, each tool call writes a metadata-only `McpRequestLog` row.

***

### toolSettings?

> `optional` **toolSettings?**: `boolean`

When true, tools are registered in `McpToolSetting` on mount and tools an admin turned off
are left out of `tools/list` and `tools/call`.

***

### userModel

> **userModel**: [`UserModel`](UserModel.md)
