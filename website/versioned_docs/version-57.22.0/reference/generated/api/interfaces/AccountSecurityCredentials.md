One user's sign-in methods as stored by Better Auth. Holds ids only, never key material.

## Properties

### accounts

> **accounts**: `object`[]

Account rows: one per linked provider account, plus `credential` for the password.

#### id

> **id**: `string`

#### providerId

> **providerId**: `string`

***

### betterAuthId

> **betterAuthId**: `string`

***

### emailVerified

> **emailVerified**: `boolean`

Better Auth `emailVerified`.

***

### passkeys

> **passkeys**: `object`[]

Passkeys; always empty when the `passkey` feature is off.

#### id

> **id**: `string`

#### name

> **name**: `string` \| `null`
