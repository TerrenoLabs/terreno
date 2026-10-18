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
  admin/
    _layout.tsx            # AdminShellLayout wrapper
    index.tsx              # AdminHome
    [model]/
      index.tsx            # AdminScreenRouter (table or custom screen)
      create.tsx           # AdminModelForm (create)
      [id].tsx             # AdminModelForm (edit)
components/                # Screen components (NOT in app/)
hooks/                     # Custom hooks
store/
  index.ts                 # Redux store + generateAuthSlice
  sdk.ts                   # Hand-maintained SDK extensions
  openApiSdk.ts            # Generated — never edit manually
```

### Rules

- Routes belong in `app/`; everything else lives outside.
- Never co-locate `components/`, `utils/`, or `types/` inside `app/`.
- Ensure a route matches `/` so the app is never blank.
- Use `(group)` routes to organize without affecting URLs.
- Use `_layout.tsx` for stacks and provider wrappers.

### Auth-gated routing

```tsx
import {Redirect, Stack, useSegments} from "expo-router";
import {useSelectCurrentUserId} from "@terreno/rtk";

const RootLayoutNav: React.FC = () => {
  const userId = useSelectCurrentUserId();
  const segments = useSegments();

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
import {baseUrl} from "@terreno/rtk";
import {Stack} from "expo-router";
import {getAdminAuthHeaders} from "@/store/betterAuthApi";

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
