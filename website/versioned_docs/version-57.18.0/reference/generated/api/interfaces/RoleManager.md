## Properties

### assertCanModifyUser

> **assertCanModifyUser**: (`args`) => `Promise`\<`void`\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### assign

> **assign**: (`args`) => `Promise`\<`void`\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### roleNames

`string`[]

###### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### create

> **create**: (`args`) => `Promise`\<[`RbacRoleDocument`](RbacRoleDocument.md)\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### role

[`RoleInput`](RoleInput.md)

#### Returns

`Promise`\<[`RbacRoleDocument`](RbacRoleDocument.md)\>

***

### list

> **list**: () => `Promise`\<[`RbacRoleDocument`](RbacRoleDocument.md)[]\>

#### Returns

`Promise`\<[`RbacRoleDocument`](RbacRoleDocument.md)[]\>

***

### previewAssignment

> **previewAssignment**: (`args`) => `Promise`\<[`UserPermissionDiff`](UserPermissionDiff.md)\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### roleNames

`string`[]

###### userId

`string`

#### Returns

`Promise`\<[`UserPermissionDiff`](UserPermissionDiff.md)\>

***

### previewRoleChange

> **previewRoleChange**: (`args`) => `Promise`\<[`RoleDiff`](RoleDiff.md)\>

#### Parameters

##### args

###### permissions

[`PermissionSet`](../type-aliases/PermissionSet.md)

###### roleName

`string`

#### Returns

`Promise`\<[`RoleDiff`](RoleDiff.md)\>

***

### remove

> **remove**: (`args`) => `Promise`\<`void`\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### roleName

`string`

#### Returns

`Promise`\<`void`\>

***

### seedDefaults

> **seedDefaults**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### unassign

> **unassign**: (`args`) => `Promise`\<`void`\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### roleNames

`string`[]

###### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### update

> **update**: (`args`) => `Promise`\<[`RbacRoleDocument`](RbacRoleDocument.md)\>

#### Parameters

##### args

###### actor

[`User`](User.md)

###### changes

`Partial`\<[`RoleInput`](RoleInput.md)\>

###### roleName

`string`

#### Returns

`Promise`\<[`RbacRoleDocument`](RbacRoleDocument.md)\>
