> **defaultResponseHandler**\<`T`\>(`doc`, `method`, `request`, `options`): `Promise`\<`Partial`\<`T`\> \| (`Partial`\<`T`\> \| `undefined`)[] \| `null` \| `undefined`\>

Default response handler for modelRouter. Calls toObject on each doc and returns the result,
using transformers.serializer if provided.

## Type Parameters

### T

`T`

## Parameters

### doc

`Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T` \| `Document`\<`unknown`, `unknown`, `unknown`, `Record`\<`string`, `any`\>, \{ \}\> & `T`[] \| `null`

### method

`"read"` \| `"list"` \| `"create"` \| `"update"`

### request

`Request`

### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

## Returns

`Promise`\<`Partial`\<`T`\> \| (`Partial`\<`T`\> \| `undefined`)[] \| `null` \| `undefined`\>
