> **authorizeAdminBroadcastDocument**(`__namedParameters`): `Promise`\<`"deny"` \| `"allow"` \| `"unscoped"`\>

`unscoped` means AdminApp has not registered this model — keep product
`IsOwner` / `queryFilter` behavior. `deny` / `allow` replace product read
for the admin window.

## Parameters

### \_\_namedParameters

#### doc?

`Record`\<`string`, `unknown`\>

#### modelName

`string`

#### user?

[`User`](../interfaces/User.md)

## Returns

`Promise`\<`"deny"` \| `"allow"` \| `"unscoped"`\>
