# Patterns and tools

## Widget registry (`AdminProvider.widgets`)

Three buckets. Host entries override built-ins with the same ID.

| Bucket | IDs come from | Built-ins include |
| --- | --- | --- |
| `home` | `AdminApp.home.slots` | `modelStats` / `modelsGrid`, `scriptRunner`, `versionConfig`, `recentActivity`, `feature-flags-overrides` |
| `screens` | `customScreens[].name` | `comms`, `documents`, `ai-requests`, `version-config` |
| `fields` | `admin.fieldOverrides.widget` | `textarea`, `markdown`, consent widgets |

Unknown IDs render `MissingWidget` instead of crashing. Register host widgets once
on `AdminProvider`; do not pass the deprecated `customScreens` prop on
`AdminModelList`.

Plugin backend IDs arrive via `adminContribution()`. First-party React lives in
`@terreno/admin-frontend`. Third-party plugins ship their own frontend package;
the host spreads it into `widgets`. See
[Admin plugin frontend widgets](../../../docs/explanation/admin-plugin-frontend.md).

## Model admin metadata that affects UI

Set these on `modelRouter({admin: ...})` rather than cloning tables:

- `listFields`, `searchFields`, `sortableFields`, `filters`
- `fieldsets`, `readonlyFields`, `hiddenFields`
- `group`, `recordTitleField`, `pageSize`
- `actions` / `bulkPatchAllowlist` for changelist bulk work

Reference: [admin-config](../../../docs/reference/admin-config.md).

## Platform tools

| Tool | Config flag | Typical route |
| --- | --- | --- |
| Scripts | `platformTools.scripts` | `{routeBase}/__scripts` |
| Roles | `platformTools.roles` | `rolesPath` (embedded `/roles` or `/admin/roles`) |
| Version | `platformTools.version` | `versionConfigPath` |
| Configuration | `platformTools.configuration` | `configurationPath` |
| Audit Log / Feature Flags | model `read` | `/{model.name}` via Platform section |

## Data and MCP

- Admin String-`_id` collection CRUD: windowed syncdb with `adminBroadcast`.
- ObjectId/API-only model CRUD: `useAdminModelApi(routePath, modelName)`.
- Framework and custom admin RPC: `useAdminRpc` + `useAdminRpcQuery` /
  `useAdminRpcMutation` over the `AdminProvider` client.
- After backend route changes: `cd example-frontend && bun run sdk` (non-synced
  routes, `store/apiSdk.ts`) and `bun run sync-sdk` (synced collections).
- MCP: `terreno_install_admin` scaffolds wiring; still follow this skill for
  screens and nav. `terreno_search_docs` / `terreno_get_component_docs` for APIs.

## Copy-paste custom screen

```tsx
import {AdminScreenPage} from "@terreno/admin-frontend";
import type {AdminScreenWidgetProps} from "@terreno/admin-frontend";
import {Box, Text} from "@terreno/ui";
import React from "react";

export const ExampleOpsScreen: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  return (
    <AdminScreenPage backHref={routeBase} color="transparent" padding={0} title="Ops">
      <Box padding={4}>
        <Text>Operator content</Text>
      </Box>
    </AdminScreenPage>
  );
};
```

Match `name: "example-ops"` on `AdminApp.customScreens` and
`widgets={{screens: {"example-ops": ExampleOpsScreen}}}`.
