> **setupBetterAuthUserSync**(`_auth`, `_userModel`): `void`

Kept for compatibility; it does nothing. `createBetterAuth` wires the app User sync itself
when given a `userModel`: the `terreno-app-user-sync` plugin guards Better Auth user creation
and syncs the app User as each session is created (see `createAppUserSyncPlugin`), and
`createBetterAuthSessionMiddleware` retries the sync on later requests.

## Parameters

### \_auth

`Auth`

### \_userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

`void`
