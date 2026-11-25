The authenticated user plus the credential type that proved it.

## Properties

### credential

> **credential**: [`RequestCredential`](../type-aliases/RequestCredential.md)

***

### oauthClientId?

> `optional` **oauthClientId?**: `string`

OAuth client id for an MCP OAuth access token. Never a secret.

***

### oauthFamilyId?

> `optional` **oauthFamilyId?**: `string`

OAuth rotation-chain id for an MCP OAuth access token. Never a secret.

***

### scopes?

> `optional` **scopes?**: `string`[]

Scopes granted to an MCP OAuth access token; unset for other credentials.

***

### serviceTokenId?

> `optional` **serviceTokenId?**: `string`

`McpServiceToken` document id for a service token. Never the token or its hash.

***

### user

> **user**: [`User`](User.md)
