## Extends

- `BaseActionConfig`\<`TBody`, `TQuery`, `TResponse`\>

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

`BaseActionConfig.access`

***

### allowAnonymous?

> `optional` **allowAnonymous?**: `boolean`

#### Inherited from

`BaseActionConfig.allowAnonymous`

***

### body?

> `optional` **body?**: `ZodSchema`\<`TBody`\>

#### Inherited from

`BaseActionConfig.body`

***

### description?

> `optional` **description?**: `string`

#### Inherited from

`BaseActionConfig.description`

***

### handler

> **handler**: (`ctx`) => `TResponse` \| `Promise`\<`TResponse`\>

#### Parameters

##### ctx

[`ActionContext`](ActionContext.md)\<`TDoc`, `TBody`, `TQuery`\>

#### Returns

`TResponse` \| `Promise`\<`TResponse`\>

***

### method

> **method**: `"GET"` \| `"POST"`

#### Inherited from

`BaseActionConfig.method`

***

### permissions?

> `optional` **permissions?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

#### Inherited from

`BaseActionConfig.permissions`

***

### query?

> `optional` **query?**: `ZodSchema`\<`TQuery`\>

#### Inherited from

`BaseActionConfig.query`

***

### response?

> `optional` **response?**: `ZodSchema`\<`TResponse`\>

#### Inherited from

`BaseActionConfig.response`

***

### status?

> `optional` **status?**: `number`

#### Inherited from

`BaseActionConfig.status`

***

### summary?

> `optional` **summary?**: `string`

#### Inherited from

`BaseActionConfig.summary`

***

### tag?

> `optional` **tag?**: `string`

#### Inherited from

`BaseActionConfig.tag`
