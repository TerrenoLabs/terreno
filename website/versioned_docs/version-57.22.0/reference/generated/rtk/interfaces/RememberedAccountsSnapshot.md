An immutable view of the store, replaced on every change.

## Properties

### accounts

> **accounts**: [`RememberedAccount`](RememberedAccount.md)[]

Remembered accounts, most recently used first.

***

### isHydrated

> **isHydrated**: `boolean`

False until async storage (native) has loaded. Always true for sync storage.

***

### lastUsedMethod?

> `optional` **lastUsedMethod?**: `string`

The newest account's method, or undefined when nothing is remembered.
