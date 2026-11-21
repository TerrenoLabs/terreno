> **getSchemaFromModel**\<`T`\>(`model`): `Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

Extract an OpenAPI-compatible schema from a Mongoose model.
This allows you to use the same schema definitions for both documentation
and runtime validation.

## Type Parameters

### T

`T`

## Parameters

### model

`Model`\<`T`\>

A Mongoose model

## Returns

`Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

Schema properties suitable for validation
