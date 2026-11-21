> **addMcpServiceTokenRoutes**(`app`, `options?`): `void`

Mount the self-serve MCP service token routes at `/mcp/service-tokens`. Callers must
authenticate with a session or JWT; an `mcp_` bearer is rejected so a service token
cannot list, mint, or revoke tokens.

## Parameters

### app

`Application`

### options?

[`McpServiceTokenRoutesOptions`](../interfaces/McpServiceTokenRoutesOptions.md) = `{}`

## Returns

`void`
