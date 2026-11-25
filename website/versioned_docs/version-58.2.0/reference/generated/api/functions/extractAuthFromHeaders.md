> **extractAuthFromHeaders**(`headers`, `context`): `Promise`\<[`MCPAuthResult`](../interfaces/MCPAuthResult.md) \| `undefined`\>

Resolve the caller and the credential type from raw headers using whichever auth providers
are configured, mirroring authenticateMiddleware behavior: `mcp_` service tokens and `mcpat_`
OAuth access tokens first (each is a distinct credential type), then a Better Auth session,
then a Terreno JWT.

## Parameters

### headers

`Record`\<`string`, `string` \| `string`[] \| `undefined`\>

### context

[`MCPAuthContext`](../interfaces/MCPAuthContext.md)

## Returns

`Promise`\<[`MCPAuthResult`](../interfaces/MCPAuthResult.md) \| `undefined`\>
