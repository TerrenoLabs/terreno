> **createMcpServiceTokenRouter**(`options?`): [`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md)

Build the self-serve `/mcp/service-tokens` router. The collection is synced read-only
(owner scope on `userId`): list/read over REST and sync, no client create/update/delete.
Minting and revoking are the `create` collection action and `revoke` instance action.

## Parameters

### options?

[`McpServiceTokenRoutesOptions`](../interfaces/McpServiceTokenRoutesOptions.md) = `{}`

## Returns

[`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md)
