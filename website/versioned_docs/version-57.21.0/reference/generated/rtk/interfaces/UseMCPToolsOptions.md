## Properties

### baseURL?

> `optional` **baseURL?**: `string`

Base URL of the Terreno backend. Defaults to the resolved baseUrl from constants.

***

### tokenSource?

> `optional` **tokenSource?**: `AuthProvider`

Token source for the MCP transport's `Authorization: Bearer` header. Defaults to the source
registered with `setTokenSource`, else the built-in JWT source. The transport reads
`getToken()` before every MCP request, so a refreshed or rotated token is used without a
refetch. When the source has no token as a fetch starts, that fetch connects without
authentication.
