## Properties

### access

> **access**: [`MCPToolAccess`](../type-aliases/MCPToolAccess.md)

`read` tools only read data; `write` tools can change it. Enforced for OAuth grants.

***

### description

> **description**: `string`

***

### handler

> **handler**: (`args`, `user?`) => `Promise`\<[`MCPToolResult`](MCPToolResult.md)\>

#### Parameters

##### args

[`MCPToolArgs`](../type-aliases/MCPToolArgs.md)

##### user?

[`User`](User.md)

#### Returns

`Promise`\<[`MCPToolResult`](MCPToolResult.md)\>

***

### inputSchema

> **inputSchema**: `MCPToolInputSchema`

***

### name

> **name**: `string`

***

### scope?

> `optional` **scope?**: `string`

When set, an OAuth token must hold exactly this scope to see and call the tool.

***

### zodSchema

> **zodSchema**: `ZodType`
