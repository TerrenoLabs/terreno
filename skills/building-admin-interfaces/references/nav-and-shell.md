# Nav and shell

Canonical shape: [How admin interfaces are shaped](../../../docs/explanation/admin-interface.md).

## `apiBase` vs `routeBase`

| Prop | Meaning | Embedded | admin-spa |
| --- | --- | --- | --- |
| `apiBase` | HTTP prefix for `/config` and model CRUD | `"/admin"` | `"/admin"` |
| `routeBase` | Expo Router prefix for `router.push` | `"/admin"` | `""` |

`AdminShell` navigates to `` `${routeBase}/${model.name}` ``. Using `apiBase` as
`routeBase` on the SPA sends the browser to `/admin/User` instead of `/console/User`.

## Sidebar sections (do not reorder in app code)

1. Home → `{routeBase}/`
2. Models, grouped by `admin.group` (empty group → **General**, sorted last)
3. Screens from `customScreens`
4. Platform, filtered by `platformTools`: Scripts (`/__scripts`), Roles, Version,
   Audit Log, Feature Flags, Configuration

Pass `configurationPath`, `rolesPath`, and `versionConfigPath` on
`AdminShellLayout`. Audit log and Feature Flags are still models; the shell
relocates those two into Platform.

## Chrome

- Default sidebar: `sidebarVariant="colorful"` (teal rail). Optional `"clinical"`.
- Main column: theme canvas. Nested `Page` / `AdminScreenPage`:
  `color="transparent"`, `padding={0}` unless the screen supplies its own pad.
- Breadcrumbs and `headerActions` enable the white top bar. Home typically uses
  `breadcrumbs={[{label: "Admin"}]}`.
- Below the desktop floor (1024pt, `isSupportedDesktopWidth`): hamburger + drawer. Do not hide the shell on mobile.
- Custom-screen back: `AdminScreenPage` → `router.push(backHref)`. Never
  `router.back()` as the default.

## Auth gate

`admin:access` opens the page (`GET /admin/config` 403 without it). Hosts call
`canOpenAdminPage({admin, permissions})` from `@terreno/rtk` and hide product
nav to admin with the same check.
