## Type Parameters

### TDoc

`TDoc` = `unknown`

## Properties

### check?

> `optional` **check?**: (`args`) => `boolean` \| [`PermissionSet`](../type-aliases/PermissionSet.md) \| `Promise`\<`boolean` \| [`PermissionSet`](../type-aliases/PermissionSet.md)\>

#### Parameters

##### args

[`ScopeArgs`](ScopeArgs.md)\<`TDoc`\>

#### Returns

`boolean` \| [`PermissionSet`](../type-aliases/PermissionSet.md) \| `Promise`\<`boolean` \| [`PermissionSet`](../type-aliases/PermissionSet.md)\>

***

### filter?

> `optional` **filter?**: (`args`) => `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\>

#### Parameters

##### args

[`ScopeArgs`](ScopeArgs.md)\<`TDoc`\>

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\> \| `null`\>
