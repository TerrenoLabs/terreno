> **sentryAppVersionMiddleware**(`req`, `_res`, `next`): `void`

Express middleware that captures the app version from the request header
and adds it as a tag to the current Sentry scope.

This allows filtering Sentry errors by app version.

Expected header: `App-Version`

## Parameters

### req

`Request`

### \_res

`Response`

### next

`NextFunction`

## Returns

`void`
