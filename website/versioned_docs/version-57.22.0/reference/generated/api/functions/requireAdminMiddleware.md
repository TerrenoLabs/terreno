> **requireAdminMiddleware**(`req`, `_res`, `next`): `void`

Express middleware that rejects the request with a 403 unless the authenticated user is an admin
(`req.user.admin === true`). Run it after [authenticateMiddleware](authenticateMiddleware.md) so `req.user` is
populated, e.g. `[authenticateMiddleware(), requireAdminMiddleware]`. Use this for admin-only
custom routes instead of hand-rolling an inline admin guard.

## Parameters

### req

`Request`

### \_res

`Response`

### next

`NextFunction`

## Returns

`void`
