> **applyJwtPasswordResetToBetterAuth**(`auth`, `user`, `password`): `Promise`\<`void`\>

After JWT `POST /auth/resetPassword`, update the Better Auth credential hash
(when that user exists) and delete Better Auth sessions so a dual-enrolled
account cannot keep the old password or stolen sessions.

## Parameters

### auth

`Auth`

### user

#### betterAuthId?

`string`

#### email?

`string`

### password

`string`

## Returns

`Promise`\<`void`\>
