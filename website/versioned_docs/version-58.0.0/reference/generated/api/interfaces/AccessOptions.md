## Type Parameters

### S

`S` *extends* [`Statements`](../type-aliases/Statements.md)

## Properties

### auditSink?

> `optional` **auditSink?**: [`RbacAuditSink`](../type-aliases/RbacAuditSink.md) \| [`RbacAuditSink`](../type-aliases/RbacAuditSink.md)[]

Extra destinations for RoleManager audit records (e.g. a consuming-app audit log).
The built-in `RbacAudit` collection is still written unless `persistAudit` is false.

***

### cacheTtlMs?

> `optional` **cacheTtlMs?**: `number`

***

### connection

> **connection**: `Connection`

***

### defaultRoles?

> `optional` **defaultRoles?**: [`RoleDefinition`](RoleDefinition.md)[]

***

### fieldViews?

> `optional` **fieldViews?**: [`ResourceFieldViews`](ResourceFieldViews.md)\<`S`\>

***

### organizations?

> `optional` **organizations?**: `boolean`

Opt in to organization RBAC: membership `org-admin` grants and the locked `operator` seed.
Default `false` so existing single-tenant apps stay unchanged. New apps from bootstrap pass `true`.

***

### persistAudit?

> `optional` **persistAudit?**: `boolean`

When false, skip the built-in `RbacAudit` collection. At least one `auditSink` is then
required so role mutations cannot go unaudited.

***

### readActions?

> `optional` **readActions?**: readonly `string`[]

***

### resolvePermissions?

> `optional` **resolvePermissions?**: (`args`) => `Promise`\<[`PermissionSet`](../type-aliases/PermissionSet.md) \| `null`\>

#### Parameters

##### args

###### user

[`User`](User.md)

#### Returns

`Promise`\<[`PermissionSet`](../type-aliases/PermissionSet.md) \| `null`\>

***

### scopes?

> `optional` **scopes?**: [`ResourceScopes`](../type-aliases/ResourceScopes.md)\<`S`\>

***

### sources?

> `optional` **sources?**: [`PermissionSource`](PermissionSource.md)[]

***

### statementDescriptions?

> `optional` **statementDescriptions?**: `Record`\<`string`, `Record`\<`string`, `string`\>\>

***

### statements

> **statements**: `S`

***

### userModel?

> `optional` **userModel?**: [`UserModel`](UserModel.md)
