## Properties

### access?

> `optional` **access?**: [`MCPToolAccess`](../type-aliases/MCPToolAccess.md)

`read` for tools that only read data, `write` for tools that can change it. Default:
`"write"`, so a read-only OAuth grant cannot call the tool until it declares `"read"`.

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

### name

> **name**: `string`

***

### scope?

> `optional` **scope?**: `string`

When set, an OAuth token must hold exactly this scope to see and call the tool.

***

### zodSchema

> **zodSchema**: `ZodType`
