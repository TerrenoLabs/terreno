> **currentBetterAuthEndpointBody**(): `unknown`

The parsed body of the Better Auth endpoint now being served (HTTP or a direct `auth.api`
call), or `undefined` outside one. Better Auth reads an HTTP body before its handler runs, so a
hook such as `onPasswordReset` can no longer read it from the request.

## Returns

`unknown`
