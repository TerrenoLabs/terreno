> **RbacRoleModel** = `Model`\<[`RbacRoleDocument`](../interfaces/RbacRoleDocument.md)\> & `object`

## Type Declaration

### findExactlyOne

> **findExactlyOne**: (`query`, `errorArgs?`) => `Promise`\<`Document` & [`RbacRoleDocument`](../interfaces/RbacRoleDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorConstructor`](APIErrorConstructor.md)\>

#### Returns

`Promise`\<`Document` & [`RbacRoleDocument`](../interfaces/RbacRoleDocument.md)\>

### findOneOrNone

> **findOneOrNone**: (`query`, `errorArgs?`) => `Promise`\<`Document` & [`RbacRoleDocument`](../interfaces/RbacRoleDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorConstructor`](APIErrorConstructor.md)\>

#### Returns

`Promise`\<`Document` & [`RbacRoleDocument`](../interfaces/RbacRoleDocument.md) \| `null`\>

### seedDefaults

> **seedDefaults**: (`args`) => `Promise`\<`void`\>

#### Parameters

##### args

###### extraRoles?

[`RoleDefinition`](../interfaces/RoleDefinition.md)[]

###### statements

[`Statements`](Statements.md)

#### Returns

`Promise`\<`void`\>
