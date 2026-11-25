> **findOneOrNoneFor**\<`T`\>(`model`, `query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & `T` \| `null`\>

Helper that performs a `findOneOrNone` lookup against any Mongoose model. Returns the matching
document, `null` if none match, or throws if more than one matches. If the model's schema has
the [findOneOrNone](findOneOrNone.md) plugin applied, the plugin static is used; otherwise the lookup is
performed directly via `model.find(...)`. Prefer this helper from framework code where the
consumer's model may or may not have the plugin installed.

## Type Parameters

### T

`T`

## Parameters

### model

`Model`\<`T`\>

Mongoose Model

### query

[`ModelQuery`](../type-aliases/ModelQuery.md)\<`T`\>

Mongoose query object

### errorArgs?

`Partial`\<[`APIErrorOptions`](../interfaces/APIErrorOptions.md)\>

Optional overrides for the thrown [APIError](../classes/APIError.md) when multiple match

## Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & `T` \| `null`\>
