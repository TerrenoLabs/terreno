> **requestContextMiddleware**(`req`, `res`, `next`): `void`

Express middleware that opens a correlation scope for the request. Mounted early by `TerrenoApp` /
`setupServer`, it resolves a `requestId` (from request-id/correlation headers, Cloud Trace, or
W3C `traceparent`, else a new UUID), captures any `jobId`/`sessionId`/trace fields, echoes
`X-Request-ID` back to the client, and runs the remaining middleware inside the scope so all
downstream logs are correlated. A later auth-aware pass ([updateRequestContextFromRequest](updateRequestContextFromRequest.md))
fills in `userId`/`sessionId`.

## Parameters

### req

`Request`

### res

`Response`

### next

`NextFunction`

## Returns

`void`
