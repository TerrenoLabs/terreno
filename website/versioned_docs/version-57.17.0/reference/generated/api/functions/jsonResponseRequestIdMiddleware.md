> **jsonResponseRequestIdMiddleware**(`req`, `res`, `next`): `void`

TerrenoApp middleware: augments `res.json` so plain-object payloads include
`requestId` for client correlation. Skips OpenAPI tooling GET JSON routes
(`/openapi.json`, `/openapi/components/...json`, `/openapi/validate`) so
machine-consumed payloads stay valid. Does not wrap arrays or primitives.

## Parameters

### req

`Request`

### res

`Response`

### next

`NextFunction`

## Returns

`void`
