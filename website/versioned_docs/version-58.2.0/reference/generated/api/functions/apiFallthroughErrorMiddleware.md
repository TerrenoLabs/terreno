> **apiFallthroughErrorMiddleware**(`err`, `_req`, `res`, `_next`): `void`

Final Express error handler for unexpected errors. Always returns JSON so
clients (e.g. RTK Query) can parse the response.

## Parameters

### err

`Error`

### \_req

`Request`

### res

`Response`

### \_next

`NextFunction`

## Returns

`void`
