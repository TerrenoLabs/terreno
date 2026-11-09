> **changeUserPassword**(`user`, `password`, `options?`): `Promise`\<`void`\>

Change a user's password on the server and end the credentials issued before it: sets the
passport password, increments `tokenEpoch` (legacy refresh tokens and MCP credentials stop
working), saves, and, when Better Auth is registered, sets the Better Auth password and deletes
that user's Better Auth sessions. Use it for every server-side password change; calling
`setPasswordForUser` alone revokes nothing.

## Parameters

### user

[`User`](../interfaces/User.md)

### password

`string`

### options?

[`ChangeUserPasswordOptions`](../interfaces/ChangeUserPasswordOptions.md) = `{}`

## Returns

`Promise`\<`void`\>
