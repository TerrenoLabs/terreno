> **applyBetterAuthPasswordResetToJwt**(`userModel`, `betterAuthUser`, `request`): `Promise`\<`void`\>

After Better Auth password reset, update the JWT/passport hash and bump
`tokenEpoch` so a dual-enrolled account cannot keep the old password or
outstanding refresh tokens.

## Parameters

### userModel

[`UserModel`](../interfaces/UserModel.md)

### betterAuthUser

#### email?

`string`

#### id?

`string`

### request

`PasswordResetRequestLike` \| `undefined`

## Returns

`Promise`\<`void`\>
