## Extended by

- [`OrganizationScopedUser`](OrganizationScopedUser.md)

## Properties

### \_id

> **\_id**: `string` \| `ObjectId`

***

### admin

> **admin**: `boolean`

***

### email?

> `optional` **email?**: `string`

Login identifier; present on passport-local and Better Auth app users.

***

### emailVerified?

> `optional` **emailVerified?**: `boolean`

Set by emailVerificationPlugin; login may require this when requireEmailVerification is on.

***

### id

> **id**: `string`

***

### isAnonymous?

> `optional` **isAnonymous?**: `boolean`

We support anonymous users, which do not yet have login information.
This can be helpful for pre-signup users.

***

### tokenEpoch?

> `optional` **tokenEpoch?**: `number`

Incremented on password reset so outstanding refresh tokens fail.
