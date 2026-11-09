> **createPermissionSelectors**(`api`): `object`

## Parameters

### api

#### reducerPath

`string`

## Returns

`object`

### selectPermissions

> **selectPermissions**: (`state`) => [`PermissionSet`](../interfaces/PermissionSet.md) \| `undefined`

#### Parameters

##### state

[`RootState`](../interfaces/RootState.md)

#### Returns

[`PermissionSet`](../interfaces/PermissionSet.md) \| `undefined`

### useCan

> **useCan**: (`request`) => `boolean`

#### Parameters

##### request

[`PermissionRequest`](../interfaces/PermissionRequest.md)

#### Returns

`boolean`

### useSelectPermissions

> **useSelectPermissions**: () => [`PermissionSet`](../interfaces/PermissionSet.md) \| `undefined`

#### Returns

[`PermissionSet`](../interfaces/PermissionSet.md) \| `undefined`
