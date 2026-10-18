# @terreno/admin-frontend

Admin panel frontend screens for @terreno/api backends.

Reusable React Native admin screens for `@terreno/api` backends — model list, tables, forms, and shell layout wired to admin CRUD routes.

## Install

```bash
bun add @terreno/admin-frontend @terreno/ui @reduxjs/toolkit react react-redux
```

Optional peer: `react-native-webview` (for consent/signature fields).

## Quick start

```typescript
// app/admin/_layout.tsx
import {AdminShellLayout} from "@terreno/admin-frontend";
import {Stack} from "expo-router";
import {api} from "@/store/openApiSdk";

export default function AdminLayout() {
  return (
    <AdminShellLayout
      api={api}
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
  );
}

// app/admin/index.tsx
import {AdminModelList} from "@terreno/admin-frontend";
import {api} from "@/store/openApiSdk";

export default function AdminIndexScreen() {
  return <AdminModelList baseUrl="/admin" api={api} />;
}
```

Pair with `@terreno/admin-backend` on the API so `/admin/config` and CRUD routes exist.

## What's included

- `AdminModelList`, `AdminModelTable`, `AdminModelForm` — windowed syncdb CRUD
  for eligible String-`_id` models, with ObjectId/API-only compatibility
- `AdminShellLayout` / `AdminShell` — sidebar + main column chrome for Expo Router apps
- `AdminFieldRenderer`, `AdminRefField` — table cell and reference link rendering
- `adminRequest` — host-bound fetch for framework admin RPC
- `useAdminApi` — deprecated Terreno 57 RTK compatibility; removed in Terreno 58
- `ConfigurationScreen`, consent editors, `DocumentStorageBrowser`, and admin script UI
- `SYSTEM_FIELDS` — fields skipped in auto-generated forms
- Types: `AdminModelConfig`, `AdminFieldConfig`, `AdminConfigResponse`, and more

## Documentation

Full API reference: [docs/reference/admin-frontend.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/admin-frontend.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
