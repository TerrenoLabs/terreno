`mcpOAuth.clientIdMetadataDocuments`: which URL client ids the server accepts.

## Properties

### allowedClientIds

> **allowedClientIds**: `string`[]

Exact https URLs accepted as `client_id`, for example
`https://claude.ai/oauth/mcp-oauth-client-metadata`. No other URL is ever fetched.

***

### fetch?

> `optional` **fetch?**: [`McpOAuthMetadataFetch`](../type-aliases/McpOAuthMetadataFetch.md)

Injected for tests. Defaults to the global `fetch`.
