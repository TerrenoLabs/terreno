> **canOpenAdminPage**(`__namedParameters`): `boolean`

Decide whether the signed-in user may open the admin UI.
With RBAC (`permissions` present), only `admin:access` grants entry.
Without RBAC, fall back to the legacy `user.admin` flag.

## Parameters

### \_\_namedParameters

#### admin?

`boolean`

#### permissions?

[`PermissionSet`](../interfaces/PermissionSet.md)

## Returns

`boolean`
