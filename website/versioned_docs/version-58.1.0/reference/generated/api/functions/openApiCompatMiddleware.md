> **openApiCompatMiddleware**(`req`, `_res`, `next`): `void`

Express middleware that patches the router stack before OpenAPI doc
generation. Must be mounted before the openapi middleware.

## Parameters

### req

`Request`

### \_res

`Response`

### next

`NextFunction`

## Returns

`void`
