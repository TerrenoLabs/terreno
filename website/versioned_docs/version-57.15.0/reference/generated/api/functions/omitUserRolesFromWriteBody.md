> **omitUserRolesFromWriteBody**(`modelName`, `accessControl`, `body`, `allowAdminWrite?`): `unknown`

When RBAC is enabled, authority-bearing User fields must not flow through ordinary mongoose
writes on `/users`, sync, or MCP. AdminApp captures role assignments before this runs and
explicitly marks authorized legacy-admin writes after its additional checks.

## Parameters

### modelName

`string`

### accessControl

`unknown`

### body

`unknown`

### allowAdminWrite?

`boolean` = `false`

## Returns

`unknown`
