# Build admin screens

Use this when adding or changing admin UI. Read [How admin interfaces are
shaped](../explanation/admin-interface.md) first.

## 1. Choose the screen kind

| Need | Do this |
| --- | --- |
| CRUD table + form for a Mongoose model | Add `admin` on `modelRouter`. Stop. No new Expo screen. |
| Dashboard tile on Home | Add a home widget ID to `AdminApp.home.slots` and register `widgets.home`. |
| Operator tool that is not a model | Register `customScreens` + `widgets.screens` with the same `name`. |
| Workflow the generic form cannot do | Dedicated Expo route (see consent and comms). Keep the model table for search. |

Adding a model: [Add a model to the admin](admin-add-model.md). Home tiles:
[Customize the admin home](admin-custom-home.md). Field editors:
[Add a custom admin field widget](admin-custom-widget.md).

## 2. Wrap the admin tree once

Embedded app (`example-frontend`):

```tsx
// app/admin/_layout.tsx
const syncConflicts = useConflicts();

<AdminProvider
  api={api}
  apiBase="/admin"
  apiOrigin={baseUrl}
  getAuthHeaders={getAdminAuthHeaders}
  routeBase="/admin"
  syncConflicts={syncConflicts}
  syncDb={adminSyncDb}
  widgets={{screens: {"sync-lab": SyncLabScreen}}}
>
  <AdminShellLayout
    api={api}
    apiBase="/admin"
    configurationPath="/admin/configuration"
    rolesPath="/roles"
    routeBase="/admin"
    versionConfigPath="/version-config"
  >
    <Stack screenOptions={{headerShown: false, contentStyle: {flex: 1}}} />
  </AdminShellLayout>
</AdminProvider>
```

Render this tree inside `SyncDbProvider client={adminSyncDb}`. If product screens
also sync the same collection, make `adminSyncDb` a dedicated client with a unique
store name and `windowCollections` set; do not mix admin rows into the owner/tenant
product store. Start that client after `canOpenAdminPage` succeeds, block the admin
shell until `start()` resolves, and call `stop()` when the admin layout unmounts.

Gate entry with `canOpenAdminPage` from `@terreno/rtk` (`admin:access`). Do not
rely on `user.admin` alone when RBAC is on. Import `baseUrl` from `@terreno/rtk`
and pass it as `apiOrigin` so admin RPC (`GET /admin/config`, `/rbac/roles`, …)
hits the API instead of the Expo web origin.

Standalone SPA (`admin-spa`): `routeBase=""`, `apiBase="/admin"`, `credentials="same-origin"`,
and `getAuthHeaders` that return `{}` so the cookie session is sent without a Bearer header.
Omit `apiOrigin`. Each route wraps `AdminShellLayout` because the root layout is only
providers. Model tables render **Create** once, in the table chrome
(`testID="admin-create-button"`), because admin Expo stacks use `headerShown: false`.
Model forms render **Save** / **Delete** in the form chrome
(`testID="admin-save-button"` / `admin-delete-button`) for the same reason.
The navigator header only receives the screen title.

## 3. Keep generic model routes generic

```
app/admin/
  _layout.tsx          # Provider + shell (embedded host)
  index.tsx            # <AdminHome />
  [model]/index.tsx    # <AdminScreenRouter name={model} />
  [model]/create.tsx   # <AdminModelForm mode="create" />
  [model]/[id].tsx     # <AdminModelForm />
```

`AdminScreenRouter` resolves the URL segment as: `__scripts` → script list,
`__migrations` → migrations status (when `GET /admin/config` has
`migrations.enabled`), matching model name → table, matching custom-screen
name → `widgets.screens[name]`, else not-found. Do not copy `AdminModelTable`
into a new file per model.

Create paths are `[model]/create`, not `new`.

## 4. Add a custom screen (both sides)

Backend (`name` is the URL segment and the widget key):

```ts
new AdminApp({
  customScreens: [{
    displayName: "SyncDB Load Lab",
    name: "sync-lab",
    description: "Stress-test the local-first sync layer",
  }],
});
```

Frontend: register `widgets.screens["sync-lab"]` on `AdminProvider`. Built-in IDs
(`comms`, `documents`, `ai-requests`, `version-config`) are already in the
registry — do not re-map them.

The screen component receives `AdminScreenWidgetProps`. Wrap UI in
`AdminScreenPage` with `backHref={routeBase}`:

```tsx
import {AdminScreenPage} from "@terreno/admin-frontend";
import type {AdminScreenWidgetProps} from "@terreno/admin-frontend";

export const OperationsScreen: React.FC<AdminScreenWidgetProps> = ({routeBase}) => (
  <AdminScreenPage backHref={routeBase} color="transparent" padding={0} title="Operations">
    {/* @terreno/ui only */}
  </AdminScreenPage>
);
```

If the screen has extra URL segments (for example `/comms/:id`), add Expo files
for those paths. Otherwise `[model]/[id]` treats the id as a generic document.

## 5. Fetch data the admin way

- String-`_id` collections configured with `adminBroadcast` use windowed syncdb
  when the host passes `syncDb` plus fetch auth.
- ObjectId model CRUD and API-only hosts keep `useAdminApi`.
- Bulk patch remains server-side: native admin fetch for windowed hosts, RTK fallback otherwise.
- Admin RPC uses the host-bound native fetch client. Do not add axios.

## 6. Sidebar and grouping

Set `admin.group` on the model so related collections share a Models heading.
Do not add sidebar links in app code. The shell reads `/admin/config`.

Platform links appear only when `platformTools` says they should. Pass
`configurationPath`, `rolesPath`, and `versionConfigPath` into `AdminShellLayout`
so those buttons have destinations. Jobs (`customScreens` name `jobs`) appears
under Platform, not Screens.

## 7. Verify

Log in as an admin (`admin@example.com` / `testpassword123` in the example). Open
`/admin` (or `/console` for the SPA). Confirm:

1. Home loads with the expected widgets.
2. The new model or screen is in the correct sidebar section.
3. Table → create → edit round-trips, or the custom screen's primary action works.
4. A user without `admin:access` cannot open the page.

Follow `verify-ui-changes`. Save evidence under `/opt/cursor/artifacts/`.
