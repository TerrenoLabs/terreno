# Route Structure — Terreno Apps

Terreno apps use Expo Router with the same file conventions as standard Expo apps. Use
Expo Router's public documentation for dynamic routes, groups, and query parameters.

## Terreno-specific conventions

### Directory layout

```
app/
  _layout.tsx              # Provider stack, auth gating, TerrenoProvider
  login.tsx                # Auth screen
  (tabs)/
    _layout.tsx            # Tab navigator
    index.tsx              # Main screen (e.g. todos list)
    profile.tsx
  mail/
    _layout.tsx            # ListDetailLayout: list pane + Stack; unstable_settings.initialRouteName = "index"
    index.tsx              # ListDetailIndex: the list on a phone, the empty state on a tablet
    [id].tsx               # Detail screen; the open item lives in the URL
  admin/
    _layout.tsx            # AdminShellLayout wrapper
    index.tsx              # AdminHome
    [model]/
      index.tsx            # AdminScreenRouter (table or custom screen)
      create.tsx           # AdminModelForm (create)
      [id].tsx             # AdminModelForm (edit)
components/                # Screen components (NOT in app/)
hooks/                     # Custom hooks
lib/
  betterAuth.ts            # createBetterAuthClient (@terreno/syncdb/auth)
store/
  syncdb.ts                # Shared authProvider + createSyncDb client
  apiClient.ts             # createApiClient for non-synced routes
  apiSdk.ts                # Generated request hooks — never edit manually
  syncDbSdk.ts             # Generated collection hooks — never edit manually
```

### Rules

- Routes belong in `app/`; everything else lives outside.
- Never co-locate `components/`, `utils/`, or `types/` inside `app/`.
- Ensure a route matches `/` so the app is never blank.
- Use `(group)` routes to organize without affecting URLs.
- Use `_layout.tsx` for stacks and provider wrappers.
- Build list/detail screens (mail, inbox, records) as a route group with `ListDetailLayout` as its
  `_layout.tsx`, `ListDetailIndex` as `index.tsx`, and the detail as `[id].tsx`. Phones push the
  detail; tablets show the list and detail side by side.

### Auth-gated routing

```tsx
import {Redirect, Stack, useSegments} from "expo-router";
import {useSession} from "@terreno/syncdb/auth";

const RootLayoutNav: React.FC = () => {
  const {userId, isLoading} = useSession();
  const segments = useSegments();

  if (isLoading) {
    return null;
  }
  if (!userId && segments[0] !== "login") {
    return <Redirect href="/login" />;
  }
  if (userId && segments[0] === "login") {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{headerShown: false}} />;
};
```

### Admin routes

Wrap admin routes once in `app/admin/_layout.tsx`:

```tsx
import {AdminProvider, AdminShellLayout} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/syncdb/config";
import {Stack} from "expo-router";
import {getAdminAuthHeaders} from "@/store/syncdb"; // Bearer header from authProvider.getToken()

export default function AdminLayout(): React.ReactElement {
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
        <Stack screenOptions={{headerShown: false, contentStyle: {flex: 1}}} />
      </AdminShellLayout>
    </AdminProvider>
  );
}
```
