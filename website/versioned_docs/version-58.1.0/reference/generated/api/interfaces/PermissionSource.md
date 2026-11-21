## Properties

### failClosedWhenDenyUnknown?

> `optional` **failClosedWhenDenyUnknown?**: `boolean`

When true (the default), a failed `getGrants` for a user this process has no last-known deny
posture for (cold instance, or the posture was evicted) throws a 503 instead of resolving
local roles without this source's deny. Set it to `false` on additive-only sources that never
return `deny`, so their outage drops only their grants.

***

### getGrants

> **getGrants**: (`args`) => `Promise`\<[`PermissionSourceGrants`](PermissionSourceGrants.md) \| `null`\>

#### Parameters

##### args

###### user

[`User`](User.md)

#### Returns

`Promise`\<[`PermissionSourceGrants`](PermissionSourceGrants.md) \| `null`\>

***

### name

> **name**: `string`

***

### staleMaxAgeMs?

> `optional` **staleMaxAgeMs?**: `number`

***

### staleOnFailure?

> `optional` **staleOnFailure?**: [`StaleOnFailurePolicy`](../type-aliases/StaleOnFailurePolicy.md)

***

### ttlMs?

> `optional` **ttlMs?**: `number`
