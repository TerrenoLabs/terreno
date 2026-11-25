AdminApp row/resource rules for `{collection}|admin` and admin-window
`GET /sync/entities`. Product `queryFilter` / `IsOwner` stay on app streams;
this registry is the AdminApp list/read contract (resource actions + tenant
`queryFilter`) so a panel user cannot fetch or live-stream rows `/admin` REST
would hide.

## Properties

### listPermissions

> **listPermissions**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

***

### queryFilter?

> `optional` **queryFilter?**: (`user?`, `query?`) => `Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\> \| `null`

#### Parameters

##### user?

[`User`](User.md)

##### query?

`Record`\<`string`, `unknown`\>

#### Returns

`Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\> \| `null`

***

### readPermissions

> **readPermissions**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]
