# @terreno/admin-frontend

Admin panel frontend screens for @terreno/api backends.

Reusable React Native admin screens for `@terreno/api` backends — model list, tables, forms, and shell layout wired to admin CRUD routes.

## Install

```bash
bun add @terreno/admin-frontend @terreno/ui react
```

Optional peer: `react-native-webview` (for consent/signature fields).

## Quick start

```typescript
// app/admin/_layout.tsx
import {AdminProvider, AdminShellLayout} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/rtk";
import {Stack} from "expo-router";
import {getAdminAuthHeaders} from "@/store/betterAuthApi"; // returns {Authorization: "Bearer …"}

const AdminLayout: React.FC = () => {
  return (
    <AdminProvider
      apiBase="/admin"
      apiOrigin={baseUrl}
      getAuthHeaders={getAdminAuthHeaders}
      routeBase="/admin"
    >
      <AdminShellLayout
        apiBase="/admin"
        configurationPath="/admin/configuration"
        routeBase="/admin"
        versionConfigPath="/version-config"
      >
        <Stack screenOptions={{headerShown: false, contentStyle: {flex: 1}}}>
          <Stack.Screen name="index" />
          <Stack.Screen name="[model]" />
        </Stack>
      </AdminShellLayout>
    </AdminProvider>
  );
};
export default AdminLayout;

// app/admin/index.tsx
import {AdminModelList} from "@terreno/admin-frontend";

const AdminIndexScreen: React.FC = () => <AdminModelList baseUrl="/admin" />;
export default AdminIndexScreen;
```

`AdminProvider` binds every admin request (model CRUD and admin RPC) to your API.
A same-origin cookie SPA passes `credentials="same-origin"` instead of
`apiOrigin` / `getAuthHeaders`. Admin components take no RTK `api` prop.

Pair with `@terreno/admin-backend` on the API so `/admin/config` and CRUD routes exist.

## What's included

- `AdminProvider` — host auth binding (cookie or Bearer) for every admin request
- `AdminModelList`, `AdminModelTable`, `AdminModelForm` — windowed syncdb CRUD
  for eligible String-`_id` models, fetch CRUD for ObjectId and API-only models
- `AdminShellLayout` / `AdminShell` — sidebar + main column chrome for Expo Router apps
- `AdminFieldRenderer`, `AdminRefField` — table cell and reference link rendering
- `adminRequest` / `useAdminRpc` — host-bound fetch for admin RPC
- `useAdminModelApi` — fetch CRUD hooks for one admin model (list, read, create,
  update, delete, bulk-patch)
- `ConfigurationScreen`, consent editors, `DocumentStorageBrowser`, and admin script UI
- `SYSTEM_FIELDS` — fields skipped in auto-generated forms
- Types: `AdminModelConfig`, `AdminFieldConfig`, `AdminConfigResponse`, and more

## Documentation

Full API reference: [docs/reference/admin-frontend.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/admin-frontend.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
