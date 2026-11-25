> **loadDocOr404**\<`T`\>(`model`, `id`, `populatePaths?`): `Promise`\<`T`\>

Loads a document by id or throws a 404 APIError.
Matches permission middleware behavior including soft-delete metadata.

## Type Parameters

### T

`T`

## Parameters

### model

`Model`\<`T`\>

### id

`string`

### populatePaths?

[`PopulatePath`](../interfaces/PopulatePath.md)[]

## Returns

`Promise`\<`T`\>
