> **applyBetterAuthPasswordResetToJwt**(`userModel`, `betterAuthUser`, `request`, `capturedPassword?`): `Promise`\<`void`\>

After Better Auth password reset, update the JWT/passport hash and bump
`tokenEpoch` so a dual-enrolled account cannot keep the old password or
outstanding refresh tokens. Only an app User that already has a JWT password gets the new one:
`POST /auth/login` has no second factor, so a Better Auth only (social) account must not gain a
way to sign in there. Its `tokenEpoch` is still bumped.

`capturedPassword` is the new password from the parsed body of the reset endpoint being served
(`newPassword`, or `password` for the email-OTP and phone-number resets). Without it the
password is read from `request`, which works only while the request body is unread.

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

### capturedPassword?

`string`

## Returns

`Promise`\<`void`\>
