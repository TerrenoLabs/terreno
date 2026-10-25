> **validateRequestBody**(`schema`, `options?`): (`req`, `res`, `next`) => `void`

Creates middleware that validates the request body against an OpenAPI schema.

The middleware checks `isConfigured` at request time — if `configureOpenApiValidator()`
has not been called, the middleware is a no-op.

## Parameters

### schema

`Record`\<`string`, [`OpenApiSchemaProperty`](../interfaces/OpenApiSchemaProperty.md)\>

The schema to validate against (same format as withRequestBody)

### options?

[`RequestBodyValidatorOptions`](../interfaces/RequestBodyValidatorOptions.md)

Optional configuration for this validator

## Returns

Express middleware function

(`req`, `res`, `next`) => `void`
