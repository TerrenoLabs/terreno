> **resolveMcpOAuthOption**(`option`): [`ResolvedMcpOAuthOptions`](../interfaces/ResolvedMcpOAuthOptions.md) \| `undefined`

Validate and default the `mcpOAuth` TerrenoApp option. Returns undefined while disabled.
Misconfiguration throws at boot rather than failing the first client's flow.

## Parameters

### option

[`McpOAuthOptions`](../interfaces/McpOAuthOptions.md) \| `undefined`

## Returns

[`ResolvedMcpOAuthOptions`](../interfaces/ResolvedMcpOAuthOptions.md) \| `undefined`
