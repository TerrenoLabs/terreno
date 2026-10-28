## Type Parameters

### S

`S` *extends* [`Statements`](../type-aliases/Statements.md)

## Properties

### ac

> `readonly` **ac**: `object`

***

### can

> **can**: (`args`) => `Promise`\<[`AccessResult`](AccessResult.md)\>

#### Parameters

##### args

[`AccessCheckArgs`](AccessCheckArgs.md)\<`S`\>

#### Returns

`Promise`\<[`AccessResult`](AccessResult.md)\>

***

### fieldMask

> **fieldMask**: (`args`) => `Promise`\<[`FieldMask`](FieldMask.md)\>

#### Parameters

##### args

###### doc?

`unknown`

###### phase?

`"write"` \| `"read"` \| `"create"`

###### resource

`string`

###### user?

[`User`](User.md)

#### Returns

`Promise`\<[`FieldMask`](FieldMask.md)\>

***

### getPermissions

> **getPermissions**: (`args`) => `Promise`\<[`PermissionSet`](../type-aliases/PermissionSet.md)\>

#### Parameters

##### args

###### user

[`User`](User.md)

#### Returns

`Promise`\<[`PermissionSet`](../type-aliases/PermissionSet.md)\>

***

### invalidateCache

> **invalidateCache**: (`args?`) => `void`

#### Parameters

##### args?

###### userId?

`string`

#### Returns

`void`

***

### middleware

> **middleware**: (`permissions`, `options?`) => `RequestHandler`

#### Parameters

##### permissions

[`PermissionRequest`](../type-aliases/PermissionRequest.md)\<`S`\>

##### options?

###### getDoc?

(`req`) => `Promise`\<`unknown`\>

#### Returns

`RequestHandler`

***

### permission

> **permission**: (`permissions`) => [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>

#### Parameters

##### permissions

[`PermissionRequest`](../type-aliases/PermissionRequest.md)\<`S`\>

#### Returns

[`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>

***

### queryFilter

> **queryFilter**: (`args`) => `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\>

#### Parameters

##### args

###### action

`string`

###### context?

`Record`\<`string`, `unknown`\>

###### resource

`string`

###### user?

[`User`](User.md)

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\> \| `null`\>

***

### roles

> **roles**: [`RoleManager`](RoleManager.md)

***

### statements

> `readonly` **statements**: `S`
