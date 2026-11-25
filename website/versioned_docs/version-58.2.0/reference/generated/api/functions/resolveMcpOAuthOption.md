> **resolveMcpOAuthOption**(`option`, `context?`): [`ResolvedMcpOAuthOptions`](../interfaces/ResolvedMcpOAuthOptions.md) \| `undefined`

Validate and default the `mcpOAuth` TerrenoApp option. Returns undefined while disabled.
Misconfiguration throws at boot rather than failing the first client's flow.

## Parameters

### option

[`McpOAuthOptions`](../interfaces/McpOAuthOptions.md) \| `undefined`

### context?

`McpOAuthBootContext` = `{}`

## Returns

[`ResolvedMcpOAuthOptions`](../interfaces/ResolvedMcpOAuthOptions.md) \| `undefined`
