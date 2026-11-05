## Extends

- [`BaseActionConfig`](BaseActionConfig.md)\<`TBody`, `TQuery`, `TResponse`\>

## Type Parameters

### TDoc

`TDoc`

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

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`access`](BaseActionConfig.md#access)

***

### allowAnonymous?

> `optional` **allowAnonymous?**: `boolean`

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`allowAnonymous`](BaseActionConfig.md#allowanonymous)

***

### body?

> `optional` **body?**: `ZodSchema`\<`TBody`\>

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`body`](BaseActionConfig.md#body)

***

### description?

> `optional` **description?**: `string`

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`description`](BaseActionConfig.md#description)

***

### handler

> **handler**: (`ctx`) => `TResponse` \| `Promise`\<`TResponse`\>

#### Parameters

##### ctx

[`ActionContext`](ActionContext.md)\<`TDoc`, `TBody`, `TQuery`\>

#### Returns

`TResponse` \| `Promise`\<`TResponse`\>

***

### mcp?

> `optional` **mcp?**: [`ActionMCPConfig`](ActionMCPConfig.md)

Also register the action as an MCP tool. The tool runs the same permission chain
(including RBAC `access`) and the same zod validation as REST. Its input is `{id, ...body}`
for an instance POST action, `{id, ...query}` for an instance GET action, and the body or
query alone for a collection action. The handler gets an MCP request
(`req.isMCPRequest === true`) and a `res` that throws if touched, so actions that write to
`res` directly cannot opt in.

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`mcp`](BaseActionConfig.md#mcp)

***

### method

> **method**: `"GET"` \| `"POST"`

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`method`](BaseActionConfig.md#method)

***

### permissions?

> `optional` **permissions?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`permissions`](BaseActionConfig.md#permissions)

***

### query?

> `optional` **query?**: `ZodSchema`\<`TQuery`\>

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`query`](BaseActionConfig.md#query)

***

### response?

> `optional` **response?**: `ZodSchema`\<`TResponse`\>

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`response`](BaseActionConfig.md#response)

***

### status?

> `optional` **status?**: `number`

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`status`](BaseActionConfig.md#status)

***

### summary?

> `optional` **summary?**: `string`

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`summary`](BaseActionConfig.md#summary)

***

### tag?

> `optional` **tag?**: `string`

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`tag`](BaseActionConfig.md#tag)

***

### unwrapResponse?

> `optional` **unwrapResponse?**: `boolean`

REST only. Send the handler's return value as the response body (with `status`) instead
of wrapping it as `{data: …}`. Use it to keep an existing route's response contract when
converting it to an action. An `undefined` return sends an empty body.

#### Inherited from

[`BaseActionConfig`](BaseActionConfig.md).[`unwrapResponse`](BaseActionConfig.md#unwrapresponse)
