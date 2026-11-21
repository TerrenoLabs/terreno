## Properties

### credential

> **credential**: [`RequestCredential`](../type-aliases/RequestCredential.md) \| `undefined`

How the caller authenticated. Only `oauth` credentials are limited by grants.

***

### grants

> **grants**: [`McpOAuthGrant`](McpOAuthGrant.md)[] \| `undefined`

Resolved `mcpOAuth.grants`, or undefined when the app does not enforce grants.

***

### tokenScopes

> **tokenScopes**: `string`[] \| `undefined`

Scopes on the caller's OAuth access token.

***

### tool

> **tool**: `Pick`\<[`MCPToolDefinition`](MCPToolDefinition.md), `"access"` \| `"scope"`\>

The tool being listed or called. Only its `access` and `scope` are read.
