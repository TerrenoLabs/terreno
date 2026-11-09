## Properties

### emailVerification?

> `optional` **emailVerification?**: `boolean`

Register JWT send-verification and verify-email routes. Default true.

***

### generateJWTPayload?

> `optional` **generateJWTPayload?**: (`user`) => `Record`\<`string`, `unknown`\>

#### Parameters

##### user

[`User`](User.md)

#### Returns

`Record`\<`string`, `unknown`\>

***

### generateRefreshTokenExpiration?

> `optional` **generateRefreshTokenExpiration?**: (`user`) => `number` \| `StringValue` \| `undefined`

#### Parameters

##### user

[`User`](User.md)

#### Returns

`number` \| `StringValue` \| `undefined`

***

### generateTokenExpiration?

> `optional` **generateTokenExpiration?**: (`user`) => `number` \| `StringValue` \| `undefined`

#### Parameters

##### user

[`User`](User.md)

#### Returns

`number` \| `StringValue` \| `undefined`

***

### legacyResetPasswordRoute?

> `optional` **legacyResetPasswordRoute?**: `boolean`

Register the deprecated `POST /resetPassword` RTK compatibility alias.
Default true. Set false when the host owns that path; `/auth/resetPassword`
remains available when `passwordReset` is enabled.

***

### passwordReset?

> `optional` **passwordReset?**: `boolean`

Register JWT forgot-password and token-reset routes. Default true.

***

### publicAppUrl?

> `optional` **publicAppUrl?**: `string`

Public web/app origin used in password-reset and verification links.

***

### requireEmailVerification?

> `optional` **requireEmailVerification?**: `boolean`

When true, unverified users receive 403 `email-not-verified` on login. Default false.

***

### sendMail?

> `optional` **sendMail?**: (`message`) => `Promise`\<`void`\>

Deliver recovery mail (forgot password / verify email). Wire to
`getCommsService().sendMail` when `@terreno/comms` is registered.

#### Parameters

##### message

[`AuthRecoveryMail`](AuthRecoveryMail.md)

#### Returns

`Promise`\<`void`\>

***

### syncPasswordResetToBetterAuth?

> `optional` **syncPasswordResetToBetterAuth?**: (`user`, `password`) => `Promise`\<`void`\>

After a successful JWT password reset, update the Better Auth credential hash
and delete that user's Better Auth sessions. TerrenoApp wires this when
BetterAuthApp is registered.

#### Parameters

##### user

[`User`](User.md)

##### password

`string`

#### Returns

`Promise`\<`void`\>

***

### verifyBetterAuthPassword?

> `optional` **verifyBetterAuthPassword?**: (`user`, `password`) => `Promise`\<[`BetterAuthPasswordCheck`](../type-aliases/BetterAuthPasswordCheck.md)\>

Check a password against the user's Better Auth credential account. `PATCH /auth/me` uses it
to confirm an email change for a user with no passport password. TerrenoApp wires this when
BetterAuthApp is registered.

#### Parameters

##### user

[`User`](User.md)

##### password

`string`

#### Returns

`Promise`\<[`BetterAuthPasswordCheck`](../type-aliases/BetterAuthPasswordCheck.md)\>
