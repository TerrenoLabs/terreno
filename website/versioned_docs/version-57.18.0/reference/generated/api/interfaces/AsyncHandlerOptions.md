Options for the asyncHandler function.

## Properties

### bodySchema?

> `optional` **bodySchema?**: `Record`\<`string`, [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)\>

Schema for validating request body.
When provided and validation is enabled, the request body will be validated
against this schema before the handler runs.

***

### querySchema?

> `optional` **querySchema?**: `Record`\<`string`, [`OpenApiSchemaProperty`](OpenApiSchemaProperty.md)\>

Schema for validating query parameters.
When provided and validation is enabled, query params will be validated
against this schema before the handler runs.

***

### validate?

> `optional` **validate?**: `boolean`

Override global validation setting for this handler.
- `true`: Enable validation regardless of global setting
- `false`: Disable validation regardless of global setting
- `undefined`: Use global setting
