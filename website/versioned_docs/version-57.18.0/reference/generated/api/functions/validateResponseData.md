> **validateResponseData**(`data`, `schema`): `object`

Validates response data against a schema.
This is primarily for development/testing to ensure responses match documentation.

## Parameters

### data

`unknown`

The response data to validate

### schema

`Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

The expected schema

## Returns

`object`

Object with valid flag and any errors

### errors?

> `optional` **errors?**: `ErrorObject`\<`string`, `Record`\<`string`, `any`\>, `unknown`\>[]

### valid

> **valid**: `boolean`
