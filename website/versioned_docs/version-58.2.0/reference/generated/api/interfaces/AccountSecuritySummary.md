The body of `GET /users/:id/security`.

## Properties

### actions

> **actions**: [`AccountSecurityActionSummary`](AccountSecurityActionSummary.md)[]

Recovery actions available for this user on this server.

***

### betterAuthLinked

> **betterAuthLinked**: `boolean`

Whether the app User is linked to a Better Auth user (`betterAuthId`).

***

### disabled

> **disabled**: `boolean`

`User.disabled`.

***

### emailVerified

> **emailVerified**: `boolean`

Better Auth `emailVerified` (`false` without a Better Auth link).

***

### lastSignIn

> **lastSignIn**: `object`

#### at

> **at**: `string` \| `null`

ISO time of the most recent session start, when known.

#### method

> **method**: `string` \| `null`

Better Auth `lastLoginMethod` (`email`, `github`, `passkey`, ...), when stored.

***

### legacyPassword

> **legacyPassword**: `boolean`

Whether the app User has a legacy JWT (passport-local-mongoose) password hash. A user with
neither this nor a Better Auth link (a GitHub-JWT user) needs an admin-issued sign-in link.

***

### passkeys

> **passkeys**: `object`

#### count

> **count**: `number`

#### items

> **items**: [`AccountSecurityPasskey`](AccountSecurityPasskey.md)[]

***

### password

> **password**: `boolean`

Whether the user has a Better Auth email and password credential.

***

### providers

> **providers**: [`AccountSecurityProvider`](AccountSecurityProvider.md)[]

Linked OAuth providers (the password credential is reported as `password`).

***

### sessions

> **sessions**: `object`

#### active

> **active**: `number`

***

### twoFactor

> **twoFactor**: `object`

#### backupCodesRemaining

> **backupCodesRemaining**: `number` \| `null`

Unused backup codes, or `null` when 2FA is off or the count cannot be read.

#### enabled

> **enabled**: `boolean`

***

### userId

> **userId**: `string`
