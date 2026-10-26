> **verifyBetterAuthCredentialPassword**(`auth`, `user`, `password`): `Promise`\<[`BetterAuthPasswordCheck`](../type-aliases/BetterAuthPasswordCheck.md)\>

Check `password` against the Better Auth credential account linked to an app user through
`betterAuthId`. Returns "no-password" when the user has no linked Better Auth user or that user
has no credential password (for example a social-only account).

## Parameters

### auth

`Auth`

### user

#### betterAuthId?

`string`

### password

`string`

## Returns

`Promise`\<[`BetterAuthPasswordCheck`](../type-aliases/BetterAuthPasswordCheck.md)\>
