## Extended by

- [`InstanceActionConfig`](InstanceActionConfig.md)
- [`CollectionActionConfig`](CollectionActionConfig.md)

## Type Parameters

### TBody

`TBody`

### TQuery

`TQuery`

### TResponse

`TResponse`

## Properties

### access?

> `optional` **access?**: `object`

#### action

> **action**: `string`

#### resource

> **resource**: `string`

***

### allowAnonymous?

> `optional` **allowAnonymous?**: `boolean`

***

### body?

> `optional` **body?**: `ZodSchema`\<`TBody`\>

***

### description?

> `optional` **description?**: `string`

***

### mcp?

> `optional` **mcp?**: [`ActionMCPConfig`](ActionMCPConfig.md)

Also register the action as an MCP tool. The tool runs the same permission chain
(including RBAC `access`) and the same zod validation as REST. Its input is `{id, ...body}`
for an instance POST action, `{id, ...query}` for an instance GET action, and the body or
query alone for a collection action. The handler gets an MCP request
(`req.isMCPRequest === true`) and a `res` that throws if touched, so actions that write to
`res` directly cannot opt in.

***

### method

> **method**: `"GET"` \| `"POST"`

***

### permissions?

> `optional` **permissions?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

***

### query?

> `optional` **query?**: `ZodSchema`\<`TQuery`\>

***

### response?

> `optional` **response?**: `ZodSchema`\<`TResponse`\>

***

### status?

> `optional` **status?**: `number`

***

### summary?

> `optional` **summary?**: `string`

***

### tag?

> `optional` **tag?**: `string`

***

### unwrapResponse?

> `optional` **unwrapResponse?**: `boolean`

REST only. Send the handler's return value as the response body (with `status`) instead
of wrapping it as `{data: …}`. Use it to keep an existing route's response contract when
converting it to an action. An `undefined` return sends an empty body.
