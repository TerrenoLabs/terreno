> **setupBetterAuthUserSync**(`_auth`, `_userModel`): `void`

Sets up Better Auth user sync hooks.
This ensures users created/updated in Better Auth are synced to the application User model.

Note: Better Auth doesn't have built-in event hooks, so we rely on the session middleware
to create users on first session access.

## Parameters

### \_auth

`Auth`

### \_userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

`void`
