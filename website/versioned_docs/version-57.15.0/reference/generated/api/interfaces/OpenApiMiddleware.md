Interface for the vendored @wesleytodd/openapi Express middleware.
Provides methods for building OpenAPI documentation from Express routes.

> **OpenApiMiddleware**(`req`, `res`, `next`): `void`

The middleware itself is callable as Express middleware.

## Parameters

### req

`Request`

### res

`Response`

### next

`NextFunction`

## Returns

`void`

## Properties

### component

> **component**: (`type`, `name?`, `description?`) => `Record`\<`string`, `unknown`\> \| `OpenApiMiddleware` \| \{ `$ref`: `string`; \} \| `undefined`

Register or retrieve an OpenAPI component definition (schemas, responses, parameters, etc).

#### Parameters

##### type

`string`

##### name?

`string`

##### description?

`Record`\<`string`, `unknown`\>

#### Returns

`Record`\<`string`, `unknown`\> \| `OpenApiMiddleware` \| \{ `$ref`: `string`; \} \| `undefined`

***

### document

> **document**: `Record`\<`string`, `unknown`\>

The generated OpenAPI document

***

### path

> **path**: (`schema?`) => `RequestHandler`

Register a path-level OpenAPI schema, returning an Express middleware that attaches the schema to the route.

#### Parameters

##### schema?

`Record`\<`string`, `unknown`\>

#### Returns

`RequestHandler`

***

### schema

> **schema**: (`name?`, `description?`) => `Record`\<`string`, `unknown`\> \| `OpenApiMiddleware` \| \{ `$ref`: `string`; \} \| `undefined`

Shorthand for component("schemas", ...)

#### Parameters

##### name?

`string`

##### description?

`Record`\<`string`, `unknown`\>

#### Returns

`Record`\<`string`, `unknown`\> \| `OpenApiMiddleware` \| \{ `$ref`: `string`; \} \| `undefined`
