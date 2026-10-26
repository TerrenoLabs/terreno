> **openApiEtagMiddleware**(`req`, `res`, `next`): `void`

Middleware to add ETag support for OpenAPI JSON endpoint.
This middleware should be added before the @wesleytodd/openapi middleware
to intercept requests to /openapi.json and add conditional request support.

## Parameters

### req

`Request`

### res

`Response`

### next

`NextFunction`

## Returns

`void`
