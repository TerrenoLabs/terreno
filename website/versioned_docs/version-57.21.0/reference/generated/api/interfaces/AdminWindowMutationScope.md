## Extends

- [`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md)

## Properties

### accessControl?

> `optional` **accessControl?**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

RBAC access used by AdminApp User admin-flag and role assignment hooks.

***

### createPermissions

> **createPermissions**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

***

### deletePermissions

> **deletePermissions**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

***

### emitAudit?

> `optional` **emitAudit?**: (`args`) => `void` \| `Promise`\<`void`\>

Legacy standalone audit callback; prefer `postCreate` / `postUpdate` / `postDelete`.

#### Parameters

##### args

###### event

[`AdminWindowMutationAuditEvent`](AdminWindowMutationAuditEvent.md)

###### req

`Request`

#### Returns

`void` \| `Promise`\<`void`\>

***

### modelName

> **modelName**: `string`

***

### permissions

> **permissions**: `object`

#### create

> **create**: `boolean`

#### delete

> **delete**: `boolean`

#### update

> **update**: `boolean`

***

### postCreate?

> `optional` **postCreate?**: (`value`, `request`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### value

`unknown`

##### request

`Request`

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

[`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md).[`postCreate`](AdminWindowMutationScopeHooks.md#postcreate)

***

### postDelete?

> `optional` **postDelete?**: (`request`, `value`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### request

`Request`

##### value

`unknown`

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

[`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md).[`postDelete`](AdminWindowMutationScopeHooks.md#postdelete)

***

### postUpdate?

> `optional` **postUpdate?**: (`value`, `cleanedBody`, `request`, `prevValue`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### value

`unknown`

##### cleanedBody

`Partial`\<`T`\>

##### request

`Request`

##### prevValue

`unknown`

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

[`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md).[`postUpdate`](AdminWindowMutationScopeHooks.md#postupdate)

***

### preCreate?

> `optional` **preCreate?**: (`value`, `request`) => `unknown`

#### Parameters

##### value

`Partial`\<`unknown`\> \| (`Partial`\<`unknown`\> \| `undefined`)[] \| `null` \| `undefined`

##### request

`Request`

#### Returns

`unknown`

#### Inherited from

[`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md).[`preCreate`](AdminWindowMutationScopeHooks.md#precreate)

***

### preDelete?

> `optional` **preDelete?**: (`value`, `request`) => `unknown`

#### Parameters

##### value

`unknown`

##### request

`Request`

#### Returns

`unknown`

#### Inherited from

[`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md).[`preDelete`](AdminWindowMutationScopeHooks.md#predelete)

***

### preUpdate?

> `optional` **preUpdate?**: (`value`, `request`) => `unknown`

#### Parameters

##### value

`Partial`\<`T`\>

##### request

`Request`

#### Returns

`unknown`

#### Inherited from

[`AdminWindowMutationScopeHooks`](AdminWindowMutationScopeHooks.md).[`preUpdate`](AdminWindowMutationScopeHooks.md#preupdate)

***

### stripMutationData

> **stripMutationData**: (`data`) => `Record`\<`string`, `unknown`\>

#### Parameters

##### data

`Record`\<`string`, `unknown`\>

#### Returns

`Record`\<`string`, `unknown`\>

***

### updatePermissions

> **updatePermissions**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]
