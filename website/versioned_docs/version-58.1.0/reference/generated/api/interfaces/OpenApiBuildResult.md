Result from building OpenAPI middleware with schemas exposed.
Useful when you want to use the schemas with asyncHandler's validation.

## Properties

### bodySchema?

> `optional` **bodySchema?**: `Record`\<`string`, [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)\>

Request body schema if defined

***

### middleware

> **middleware**: `RequestHandler`

The OpenAPI documentation middleware

***

### querySchema?

> `optional` **querySchema?**: `Record`\<`string`, [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)\>

Query parameter schemas if defined

***

### validationEnabled

> **validationEnabled**: `boolean`

Whether validation was enabled on this builder
