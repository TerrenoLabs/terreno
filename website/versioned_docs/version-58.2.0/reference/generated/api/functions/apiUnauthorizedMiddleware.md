> **apiUnauthorizedMiddleware**(`err`, `_req`, `res`, `next`): `void`

Converts the bare `Error("Unauthorized")` that Passport throws into a quiet 401.

Only the plain `Error` prototype is matched. An `APIError` carries its own status, code,
detail, and meta, so one whose title happens to be "Unauthorized" falls through to
`apiErrorMiddleware`. A domain-specific `Error` subclass with the same message also falls
through so its own handler can respond.

## Parameters

### err

`Error`

### \_req

`Request`

### res

`Response`

### next

`NextFunction`

## Returns

`void`
