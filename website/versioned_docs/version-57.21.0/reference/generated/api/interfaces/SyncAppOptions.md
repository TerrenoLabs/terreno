Options for the SyncApp plugin's HTTP routes.

## Properties

### accessControl?

> `optional` **accessControl?**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

When set, `{collection}|admin` window subscribe and cross-owner entity
hydrate require `admin:access` instead of the legacy `user.admin` flag.
AdminApp also registers per-model list/read/`queryFilter` so hydrate and
`|admin` deltas match `/admin` REST, not product `IsOwner`.

***

### canOpenAdminWindow?

> `optional` **canOpenAdminWindow?**: (`user`) => `boolean` \| `Promise`\<`boolean`\>

Override the admin-window gate. Defaults to `admin:access` when
`accessControl` is set, otherwise `Permissions.IsAdmin`.

#### Parameters

##### user

[`User`](User.md)

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### defaultSnapshotLimit?

> `optional` **defaultSnapshotLimit?**: `number`

Default page size for snapshots (default 100, max 100).

***

### getUserScopes?

> `optional` **getUserScopes?**: (`user`, `entry`) => `string`[] \| `Promise`\<`string`[]\>

Resolve the scope values a user belongs to for tenant-scoped models
(e.g. the user's organization ids). Required when any registered model uses a
tenant scope.

#### Parameters

##### user

[`User`](User.md)

##### entry

[`SyncRegistryEntry`](SyncRegistryEntry.md)

#### Returns

`string`[] \| `Promise`\<`string`[]\>
