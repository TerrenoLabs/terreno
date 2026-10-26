> **validateModelRequestBody**\<`T`\>(`model`, `options?`): (`req`, `res`, `next`) => `void`

Creates a request body validator middleware from a Mongoose model.
This is a convenience function that combines getSchemaFromModel and validateRequestBody.

## Type Parameters

### T

`T`

## Parameters

### model

`Model`\<`T`\>

A Mongoose model to derive the schema from

### options?

[`RequestBodyValidatorOptions`](../interfaces/RequestBodyValidatorOptions.md)

Optional configuration for the validator

## Returns

Express middleware function

(`req`, `res`, `next`) => `void`
