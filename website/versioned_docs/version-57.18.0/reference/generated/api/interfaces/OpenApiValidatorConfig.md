Global configuration for OpenAPI validation.
This can be set at server startup to control validation behavior.

## Properties

### coerceTypes?

> `optional` **coerceTypes?**: `boolean`

Whether to coerce types (e.g., string "123" to number 123).
Default: true

***

### logValidationErrors?

> `optional` **logValidationErrors?**: `boolean`

Log validation errors for debugging.
Default: true

***

### onAdditionalPropertiesRemoved?

> `optional` **onAdditionalPropertiesRemoved?**: (`removedProperties`, `req`) => `void`

Callback fired when additional properties are removed from a request body.
Only fires when `removeAdditional: true` and extra properties are present.
Receives the list of removed property names and the request.

#### Parameters

##### removedProperties

`string`[]

##### req

`Request`

#### Returns

`void`

***

### onValidationError?

> `optional` **onValidationError?**: (`errors`, `req`) => `void`

Custom error handler for validation failures.
If not provided, throws an APIError with status 400.

#### Parameters

##### errors

`ErrorObject`\<`string`, `Record`\<`string`, `any`\>, `unknown`\>[]

##### req

`Request`

#### Returns

`void`

***

### removeAdditional?

> `optional` **removeAdditional?**: `boolean`

Whether to remove additional properties not in the schema.
Default: true

***

### validateRequests?

> `optional` **validateRequests?**: `boolean`

Enable or disable request body validation.
Default: true (when configureOpenApiValidator is called)

***

### validateResponses?

> `optional` **validateResponses?**: `boolean`

Enable or disable response validation.
Default: false (response validation has performance overhead)
