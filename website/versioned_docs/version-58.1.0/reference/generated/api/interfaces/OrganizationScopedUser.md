A user that may belong to one or more organizations (tenants). Backends that use tenant-scoped
models add an `organizationIds` array to their user model; this interface lets the shared
permission/query-filter helpers read it without every consumer casting by hand.

## Extends

- [`User`](User.md)

## Properties

### \_id

> **\_id**: `string` \| `ObjectId`

#### Inherited from

[`User`](User.md).[`_id`](User.md#_id)

***

### admin

> **admin**: `boolean`

#### Inherited from

[`User`](User.md).[`admin`](User.md#admin)

***

### email?

> `optional` **email?**: `string`

Login identifier; present on passport-local and Better Auth app users.

#### Inherited from

[`User`](User.md).[`email`](User.md#email)

***

### emailVerified?

> `optional` **emailVerified?**: `boolean`

Set by emailVerificationPlugin; login may require this when requireEmailVerification is on.

#### Inherited from

[`User`](User.md).[`emailVerified`](User.md#emailverified)

***

### id

> **id**: `string`

#### Inherited from

[`User`](User.md).[`id`](User.md#id)

***

### isAnonymous?

> `optional` **isAnonymous?**: `boolean`

We support anonymous users, which do not yet have login information.
This can be helpful for pre-signup users.

#### Inherited from

[`User`](User.md).[`isAnonymous`](User.md#isanonymous)

***

### organizationIds?

> `optional` **organizationIds?**: `string`[]

***

### tokenEpoch?

> `optional` **tokenEpoch?**: `number`

Incremented on password reset so outstanding refresh tokens fail.

#### Inherited from

[`User`](User.md).[`tokenEpoch`](User.md#tokenepoch)
