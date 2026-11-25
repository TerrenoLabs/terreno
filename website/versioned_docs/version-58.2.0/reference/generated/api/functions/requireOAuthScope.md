> **requireOAuthScope**(`scope`): [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>

Permission that refuses an MCP OAuth access token unless it was granted `scope`. Other
credentials (the user's own JWT or Better Auth session, and `mcp_` service tokens) are not
scoped and pass. Combine it with the method's other permissions, for example
`[Permissions.IsAuthenticated, requireOAuthScope("write")]`.

## Parameters

### scope

`string`

## Returns

[`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>
