One account remembered on this device.

## Properties

### email?

> `optional` **email?**: `string`

Masked email such as `j***@n***.io`. Stored only with `rememberIdentity: true`.

***

### image?

> `optional` **image?**: `string`

Avatar URL (https only). Stored only with `rememberIdentity: true`.

***

### lastUsedAt

> **lastUsedAt**: `string`

When the account last signed in on this device, as an ISO 8601 UTC timestamp.

***

### method

> **method**: `string`

How the account last signed in: a provider id, `"email"`, or `"passkey"`.

***

### name?

> `optional` **name?**: `string`

Display name. Stored only with `rememberIdentity: true`.

***

### userId

> **userId**: `string`

The Better Auth user id.
