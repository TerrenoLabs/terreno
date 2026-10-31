## Properties

### max?

> `optional` **max?**: `number`

How many accounts to keep, newest first. Defaults to 5.

***

### rememberIdentity

> **rememberIdentity**: `boolean`

Required. Pass `false` to remember only the method (the conservative choice for shared
devices), or `true` to also remember name, masked email and avatar.

***

### storage?

> `optional` **storage?**: [`RememberedAccountsStorage`](RememberedAccountsStorage.md)

Storage override. Defaults to SecureStore on native and localStorage on web.

***

### storageKey?

> `optional` **storageKey?**: `string`

Storage key. Defaults to `terreno_remembered_accounts`. On native it must use only
letters, digits, `.`, `-` and `_` (an expo-secure-store requirement).
