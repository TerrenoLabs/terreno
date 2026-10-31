## Properties

### deleteAccounts

> **deleteAccounts**: (`args`) => `Promise`\<`number`\>

Deletes the user's account rows for `providerId`. Returns how many were removed.

#### Parameters

##### args

###### betterAuthId

`string`

###### providerId

`string`

#### Returns

`Promise`\<`number`\>

***

### deletePasskey

> **deletePasskey**: (`args`) => `Promise`\<`boolean`\>

Deletes one passkey, only when it belongs to `betterAuthId`. Returns whether it existed.

#### Parameters

##### args

###### betterAuthId

`string`

###### passkeyId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### issueSignInLink

> **issueSignInLink**: (`target`) => `Promise`\<[`SignInLinkResult`](../type-aliases/SignInLinkResult.md)\>

For a User with no Better Auth link and no legacy password: creates their Better Auth user
(email unverified), links it by `betterAuthId`, and returns a single-use set-password link.
A User whose link was never used (its Better Auth user still has no sign-in method and an
unverified email) gets a fresh link for the same Better Auth user; earlier links stop working.

#### Parameters

##### target

[`User`](User.md)

#### Returns

`Promise`\<[`SignInLinkResult`](../type-aliases/SignInLinkResult.md)\>

***

### loadTarget

> **loadTarget**: (`userId`) => `Promise`\<[`User`](User.md)\>

The app User with this id, or 404 (an id that is not an ObjectId is also 404).

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<[`User`](User.md)\>

***

### readCredentials

> **readCredentials**: (`target`, `features`) => `Promise`\<[`AccountSecurityCredentials`](AccountSecurityCredentials.md) \| `undefined`\>

The user's sign-in methods, or `undefined` when the user has no Better Auth link.

#### Parameters

##### target

[`User`](User.md)

##### features

[`AccountSecurityFeatures`](AccountSecurityFeatures.md)

#### Returns

`Promise`\<[`AccountSecurityCredentials`](AccountSecurityCredentials.md) \| `undefined`\>

***

### readFeatures

> **readFeatures**: () => `Promise`\<[`AccountSecurityFeatures`](AccountSecurityFeatures.md)\>

#### Returns

`Promise`\<[`AccountSecurityFeatures`](AccountSecurityFeatures.md)\>

***

### readState

> **readState**: (`target`, `features`) => `Promise`\<[`AccountSecurityState`](../type-aliases/AccountSecurityState.md)\>

#### Parameters

##### target

[`User`](User.md)

##### features

[`AccountSecurityFeatures`](AccountSecurityFeatures.md)

#### Returns

`Promise`\<[`AccountSecurityState`](../type-aliases/AccountSecurityState.md)\>

***

### resetTwoFactor

> **resetTwoFactor**: (`target`) => `Promise`\<\{ `changed`: `boolean`; \}\>

Removes the user's TOTP secret and backup codes and turns 2FA off. `changed` is false when
2FA was already off (or the user has no Better Auth link).

#### Parameters

##### target

[`User`](User.md)

#### Returns

`Promise`\<\{ `changed`: `boolean`; \}\>

***

### revokeSessions

> **revokeSessions**: (`target`) => `Promise`\<\{ `jwtRefreshRevoked`: `boolean`; `revokedCount`: `number`; \}\>

Deletes every Better Auth session the user has (bearer tokens and cookie sessions alike) and,
when the User model has `tokenEpoch`, bumps it so legacy JWT refresh tokens stop working.
`revokedCount` is how many active sessions were deleted.

#### Parameters

##### target

[`User`](User.md)

#### Returns

`Promise`\<\{ `jwtRefreshRevoked`: `boolean`; `revokedCount`: `number`; \}\>

***

### sendPasswordReset

> **sendPasswordReset**: (`target`) => `Promise`\<[`PasswordResetResult`](../type-aliases/PasswordResetResult.md)\>

Mails the user a Better Auth password-reset link through the configured
`emailAndPassword.sendResetPassword` hook (Terreno's `sendMail` + `publicAppUrl`). The hook
is awaited, so a delivery failure (such as the hook's 501 for a missing `publicAppUrl`)
throws instead of being logged and dropped as Better Auth's own endpoint does.

#### Parameters

##### target

[`User`](User.md)

#### Returns

`Promise`\<[`PasswordResetResult`](../type-aliases/PasswordResetResult.md)\>

***

### setDisabled

> **setDisabled**: (`target`, `disabled`) => `Promise`\<\{ `changed`: `boolean`; \}\>

Sets `User.disabled`. `changed` is false when it already had that value.

#### Parameters

##### target

[`User`](User.md)

##### disabled

`boolean`

#### Returns

`Promise`\<\{ `changed`: `boolean`; \}\>
