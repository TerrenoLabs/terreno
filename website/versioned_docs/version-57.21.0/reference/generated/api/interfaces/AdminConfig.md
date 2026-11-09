## Properties

### actions?

> `optional` **actions?**: [`AdminAction`](AdminAction.md)[]

***

### adminAccess?

> `optional` **adminAccess?**: [`AdminAccessConfig`](AdminAccessConfig.md)

Fine-grained admin RBAC and optional ownership/custom authorization.

***

### adminFilter?

> `optional` **adminFilter?**: (`req`) => `Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\>\>

#### Parameters

##### req

`Request`

#### Returns

`Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\>\>

***

### adminPermissions?

> `optional` **adminPermissions?**: `Partial`\<\{ `create`: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]; `delete`: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]; `list`: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]; `read`: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]; `update`: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]; \}\>

***

### autocompleteFields?

> `optional` **autocompleteFields?**: `string`[]

***

### bulkPatchAllowlist?

> `optional` **bulkPatchAllowlist?**: `string`[]

***

### defaultSort?

> `optional` **defaultSort?**: `string` \| `string`[]

***

### displayName

> **displayName**: `string`

***

### excludeFields?

> `optional` **excludeFields?**: `string`[]

***

### fieldOrder?

> `optional` **fieldOrder?**: `string`[]

***

### fieldOverrides?

> `optional` **fieldOverrides?**: `Record`\<`string`, [`AdminFieldOverride`](AdminFieldOverride.md)\>

***

### fieldsets?

> `optional` **fieldsets?**: [`AdminFieldset`](AdminFieldset.md)[]

***

### filters?

> `optional` **filters?**: [`AdminFilter`](../type-aliases/AdminFilter.md)[]

***

### group?

> `optional` **group?**: `string`

***

### hiddenFields?

> `optional` **hiddenFields?**: `string`[]

***

### icon?

> `optional` **icon?**: `string`

***

### includeDeleted?

> `optional` **includeDeleted?**: `boolean`

Forward-compat placeholder — no behavior in v1.

***

### listDisplay?

> `optional` **listDisplay?**: `string`[]

***

### listDisplayLinks?

> `optional` **listDisplayLinks?**: `string`[]

***

### listFields

> **listFields**: `string`[]

***

### pageSize?

> `optional` **pageSize?**: `number`

***

### readonlyFields?

> `optional` **readonlyFields?**: `string`[]

***

### realtime?

> `optional` **realtime?**: `boolean`

When true, scrubbed `admin:model.changed` events fire after mutations (no socket transport).

***

### recordTitleField?

> `optional` **recordTitleField?**: `string`

***

### searchFields?

> `optional` **searchFields?**: `string`[]

***

### sortableFields?

> `optional` **sortableFields?**: `string`[]
