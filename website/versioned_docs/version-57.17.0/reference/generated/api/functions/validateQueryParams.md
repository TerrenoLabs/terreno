> **validateQueryParams**(`schema`, `options?`): (`req`, `res`, `next`) => `void`

Creates middleware that validates query parameters against an OpenAPI schema.

## Parameters

### schema

`Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

The schema to validate against

### options?

[`QueryValidatorOptions`](../interfaces/QueryValidatorOptions.md)

Optional configuration for this validator

## Returns

Express middleware function

(`req`, `res`, `next`) => `void`
