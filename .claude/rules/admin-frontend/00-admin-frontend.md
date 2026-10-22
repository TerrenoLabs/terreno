---
paths:
  - '**/*'
---
# @terreno/admin-frontend

Human architecture: `docs/explanation/admin-interface.md` and
`docs/how-to/build-admin-screens.md`. Agent workflow: skill
`building-admin-interfaces`.

Admin panel frontend screens for `@terreno/api` backends. This is a **frontend-only**
package — no Express, no Mongoose, no backend code.

## Commands

```bash
bun run compile          # Compile TypeScript
bun run dev              # Watch mode (TypeScript watch)
bun run lint             # Lint code
bun run lint:fix         # Fix lint issues
```

## Architecture

### File Structure

```
src/
  index.tsx              # Package exports
  types.ts               # TypeScript interfaces (AdminModelConfig, AdminFieldConfig, etc.)
  AdminModelList.tsx     # List of all admin models (entry screen)
  AdminModelTable.tsx    # Table view for a specific model (list with pagination)
  AdminModelForm.tsx     # Create/edit form for a model instance
  AdminShellLayout.tsx   # Sidebar + main column shell for Expo admin apps
  AdminFieldRenderer.tsx # Renders individual fields in table cells
  AdminRefField.tsx      # Renders reference fields as clickable links
  AdminProvider.tsx      # Host auth binding (fetch client), syncDb, widget registry
  useAdminConfig.ts      # Hook to fetch admin config from backend
  adminRequest.ts        # Native fetch client every admin request goes through
  useAdminRpc.ts         # useAdminRpc / useAdminRpcQuery / useAdminRpcMutation
  useAdminModelApi.ts    # Fetch CRUD hooks for one admin model
```

## Key Exports

```typescript
import {
  AdminModelList,        // Model list screen (entry point)
  AdminModelTable,       // Table view for a specific model
  AdminModelForm,        // Create/edit form
  AdminProvider,         // Required host binding: auth, apiOrigin, syncDb, widgets
  AdminShellLayout,      // Sidebar + flex main column (default for Expo admin root)
  type AdminShellSidebarVariant, // "colorful" (teal rail, default) | "clinical" (light rail)
  AdminFieldRenderer,    // Field renderer for table cells
  AdminRefField,         // Reference field renderer
  useAdminConfig,        // Hook to fetch admin config
  useAdminModelApi,      // Fetch CRUD hooks for one admin model
  useAdminRpc,           // Host-bound fetch client for custom admin RPC
  SYSTEM_FIELDS,         // Fields to skip in forms
} from "@terreno/admin-frontend";
```

## Usage

### Setup in Expo Router

```typescript
// app/admin/_layout.tsx — wrap the admin Stack once so every route gets auth + sidebar
import {AdminProvider, AdminShellLayout} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/syncdb/config";
import {Stack} from "expo-router";
import {getAdminAuthHeaders} from "@/store/syncdb"; // bearer header from authProvider.getToken()

export default function AdminLayout() {
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
}

// app/admin/index.tsx
import {AdminModelList} from "@terreno/admin-frontend";

export default function AdminIndexScreen() {
  return <AdminModelList baseUrl="/admin" />;
}

// app/admin/[modelName]/index.tsx
import {AdminModelTable} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";

export default function AdminModelScreen() {
  const {modelName} = useLocalSearchParams();
  return <AdminModelTable baseUrl="/admin" modelName={modelName as string} />;
}

// app/admin/[modelName]/new.tsx and [id].tsx
import {AdminModelForm} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";

export default function AdminFormScreen() {
  const {modelName, id} = useLocalSearchParams();
  return <AdminModelForm
    baseUrl="/admin"
    modelName={modelName as string}
    id={id as string | undefined}
  />;
}
```

`AdminProvider` is required: every admin request (model CRUD and RPC) goes through
its fetch client. Cookie SPAs pass `credentials="same-origin"` instead of
`apiOrigin` / `getAuthHeaders`. Admin components take no RTK `api` prop (removed in
Terreno 58). Product screens that reuse admin components (`DocumentStorageBrowser`,
`ConsentHistory`) also need an `AdminProvider` with the same auth binding.

### AdminShellLayout chrome

Matches the Flourish `adminv2.html` shell: **`body`-style canvas** (`neutral-050` via theme primitive on the main column), default **`sidebarVariant="colorful"`** (brand teal `secondaryDark` / `#2B6072`, **280px** rail + light nav labels), optional **`sidebarVariant="clinical"`**, a white **top bar** (28px horizontal padding) when **`breadcrumbs`** or **`headerActions`** are set, and a **`.page-pad`-equivalent** inner column (`padding: 24px 28px 80px`, `max-width: 1280px`). Admin **`Page`** screens use **`color="transparent"`** and **`padding={0}`** so cards sit on that canvas. Pass **`breadcrumbs={[{label: "Admin"}]}`** on the admin home route for a single crumb like the prototype.

## Components

### AdminModelList

Entry point that displays all available admin models as cards.

```typescript
<AdminModelList
  baseUrl="/admin"         // Base URL for admin routes
/>
```

Features:
- Fetches config from `{baseUrl}/config`
- Displays models as clickable cards
- Shows field count for each model
- Navigates to `{baseUrl}/{modelName}` on click

### AdminModelTable

Table view for a specific model with pagination, sorting, and actions.

```typescript
<AdminModelTable
  baseUrl="/admin"
  modelName="User"
/>
```

Features:
- Uses DataTable from @terreno/ui
- Column headers from `listFields` in backend config
- Click row to edit
- "Create New" button (navigates to `{baseUrl}/{modelName}/new`)
- Pagination controls
- Loading and error states
- Reference fields render as clickable links (via AdminRefField)

### AdminModelForm

Create or edit form for a model instance.

```typescript
<AdminModelForm
  baseUrl="/admin"
  modelName="User"
  id="507f1f77bcf86cd799439011"  // Optional, for edit mode
/>
```

Features:
- Auto-generates fields from model schema
- Skips system fields (_id, __v, created, updated, deleted)
- Field types mapped from schema:
  - `string` → TextField
  - `boolean` → BooleanField
  - `number` → NumberField
  - `date` → DateTimeField
  - `objectid` (ref) → SelectField (fetches options from referenced model)
  - `enum` → SelectField with enum values
- Validates required fields
- Save button (creates or updates)
- Cancel button (navigates back)
- Loading states during save

### AdminFieldRenderer

Renders field values in table cells with appropriate formatting.

```typescript
<AdminFieldRenderer
  value={value}
  field={fieldConfig}
  modelName="User"
  baseUrl="/admin"
/>
```

Handles:
- Booleans → "Yes"/"No" or checkmark icon
- Dates → Formatted with Luxon
- ObjectId refs → Link to referenced model (via AdminRefField)
- Arrays → Comma-separated or count
- Objects → JSON.stringify
- Null/undefined → empty

### AdminRefField

Renders reference fields as clickable links that navigate to the referenced model's detail view.

```typescript
<AdminRefField
  value={userId}           // ObjectId value
  refModel="User"          // Referenced model name
  baseUrl="/admin"
/>
```

## Hooks

### useAdminConfig

Fetches admin configuration from backend.

```typescript
const {config, isLoading, error} = useAdminConfig(baseUrl);

// config: AdminConfigResponse | undefined
// {
//   models: [
//     {
//       name: "User",
//       routePath: "/admin/users",
//       displayName: "Users",
//       listFields: ["email", "name", "admin"],
//       defaultSort: "-created",
//       fields: {
//         email: {type: "string", required: true, description: "User email"},
//         name: {type: "string", required: false},
//         admin: {type: "boolean", required: false, default: false},
//       }
//     }
//   ]
// }
```

### useAdminModelApi

Fetch CRUD hooks for one admin model over the `AdminProvider` client. Pass the
model's `routePath` from config (for example `/admin/users`). Replaces the removed
Terreno 57 `useAdminApi(api, routePath, modelName)`. String-`_id` models with
`adminBroadcast` still use windowed syncdb inside `AdminModelTable` / `AdminModelForm`.

```typescript
const {
  useListQuery,         // GET {routePath} (list envelope with pagination)
  useReadQuery,         // GET {routePath}/:id (document)
  useCreateMutation,    // POST {routePath}
  useUpdateMutation,    // PATCH {routePath}/:id — trigger({id, body})
  useDeleteMutation,    // DELETE {routePath}/:id
  useBulkPatchMutation, // POST {routePath}/bulk-patch — trigger({ids, patch})
} = useAdminModelApi("/admin/users", "User");

const {data, isLoading} = useListQuery({limit: 20, page: 1});
const [create, {isLoading: isCreating}] = useCreateMutation();
await create({email: "test@example.com", name: "Test User"}).unwrap();
```

Custom admin RPC: `const rpc = useAdminRpc();` then
`useAdminRpcQuery({rpc, url})` / `useAdminRpcMutation(rpc, {invalidatesTags})`.

## Types

```typescript
interface AdminFieldConfig {
  type: string;                // Field type
  required: boolean;           // Is field required
  description?: string;        // Field description
  enum?: string[];             // Enum values if applicable
  default?: any;               // Default value
  ref?: string;                // Referenced model name for ObjectId refs
}

interface AdminModelConfig {
  name: string;                // Model name
  routePath: string;           // Full route path
  displayName: string;         // Human-readable name
  listFields: string[];        // Fields to show in table
  defaultSort: string;         // Default sort order
  fields: Record<string, AdminFieldConfig>;  // Field metadata
}

interface AdminConfigResponse {
  models: AdminModelConfig[];
}

interface AdminScreenProps {
  baseUrl?: string;            // Deprecated alias for apiBase + routeBase
  apiBase?: string;            // Base path for admin HTTP requests ("/admin")
  routeBase?: string;          // Base path for in-app navigation
}
```

## System Fields

Fields that are automatically skipped in forms:

```typescript
export const SYSTEM_FIELDS = new Set([
  "_id",
  "id",
  "__v",
  "created",
  "updated",
  "deleted",
]);
```

## Conventions

- Always use @terreno/ui components (Box, Button, TextField, etc.) — never raw React Native components
- Use functional components with `React.FC` type
- Use windowed syncdb for String-`_id` models with `adminBroadcast`; use
  `useAdminModelApi` for ObjectId/API-only model CRUD
- Every admin request goes through the `AdminProvider` fetch client; never pass
  an RTK `api` prop, use axios, or call `injectEndpoints` for admin
- Handle loading, error, and empty states in all screens
- Use `console.info/debug/warn/error` for permanent logs
- Use Luxon for date operations
- Always support React Native Web
- Use inline styles over `StyleSheet.create`

## Integration with @terreno/admin-backend

Frontend expects backend to:
1. Provide `/admin/config` endpoint with model metadata
2. Provide CRUD routes at `{basePath}{routePath}` for each model
3. Require admin authentication (IsAdmin permission)
4. Return paginated list responses with `{data, page, limit, total, more}` structure

## Common Patterns

### Protected Admin Routes

```typescript
// app/_layout.tsx
import {Spinner} from "@terreno/ui";
import {Redirect, Stack, usePathname} from "expo-router";
import {useGetAuthMeQuery} from "@/store/apiSdk"; // generated by `bun run sdk`

const RootLayout: React.FC = () => {
  const pathname = usePathname();
  const {data: user, isLoading} = useGetAuthMeQuery();

  if (isLoading) {
    return <Spinner />;
  }

  // Redirect non-admin users away from admin routes
  if (!user?.admin && pathname.startsWith("/admin")) {
    return <Redirect href="/" />;
  }

  return <Stack />;
};
```

### Custom Field Renderers

Extend `AdminFieldRenderer` for custom field types:

```typescript
// In your app code
const CustomFieldRenderer = ({value, field, ...props}) => {
  if (field.type === "myCustomType") {
    return <MyCustomComponent value={value} />;
  }
  return <AdminFieldRenderer value={value} field={field} {...props} />;
};
```

## Error Handling

- Backend errors (401, 403, 500) are displayed in error states
- Form validation errors highlight invalid fields
- Network errors show error messages with retry option
- All mutations call `.unwrap()` to catch errors (`AdminAPIError` with `status` and `data.title`)
