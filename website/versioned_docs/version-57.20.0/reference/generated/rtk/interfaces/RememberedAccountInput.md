What [RememberedAccountsStore.record](RememberedAccountsStore.md#record) accepts after a successful sign-in.

## Properties

### email?

> `optional` **email?**: `string` \| `null`

Kept only with `rememberIdentity: true`, and always masked before it is stored.

***

### image?

> `optional` **image?**: `string` \| `null`

Kept only with `rememberIdentity: true`.

***

### lastUsedAt?

> `optional` **lastUsedAt?**: `string`

ISO 8601 timestamp. Defaults to now.

***

### method

> **method**: `string`

***

### name?

> `optional` **name?**: `string` \| `null`

Kept only with `rememberIdentity: true`.

***

### userId

> **userId**: `string`
