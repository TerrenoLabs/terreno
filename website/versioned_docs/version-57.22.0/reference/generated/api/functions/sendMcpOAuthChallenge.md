> **sendMcpOAuthChallenge**(`res`, `oauth`, `__namedParameters`): `void`

Answer an unauthenticated `/mcp` request with the RFC 9728 challenge that starts a client's
OAuth discovery. `invalidToken` marks a presented-but-rejected credential so clients refresh.

## Parameters

### res

`Response`

### oauth

[`ResolvedMcpOAuthOptions`](../interfaces/ResolvedMcpOAuthOptions.md)

### \_\_namedParameters

#### invalidToken

`boolean`

## Returns

`void`
