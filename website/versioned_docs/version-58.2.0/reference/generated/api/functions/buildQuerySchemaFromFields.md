> **buildQuerySchemaFromFields**\<`T`\>(`model`, `queryFields?`): `Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

Build a query parameter schema from a model's Mongoose schema and queryFields array.
Always includes pagination parameters (limit, page, sort).

## Type Parameters

### T

`T`

## Parameters

### model

`Model`\<`T`\>

A Mongoose model

### queryFields?

`string`[] = `[]`

Array of field names allowed for querying

## Returns

`Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

Schema properties suitable for query validation
