---
name: building-admin-interfaces
description: >-
  Build Terreno admin UIs with @terreno/admin-frontend and @terreno/admin-backend.
  Use when adding or changing admin screens, AdminShell sidebar nav, AdminHome,
  custom screens, AdminScreenRouter, AdminProvider widgets, admin-spa routes,
  or operator tools. Covers where models vs custom screens vs platform tools go.
  Not for product (non-admin) Expo screens — use building-terreno-apps.
---
# Building Admin Interfaces

Use this skill when the work is an **admin** surface: `/admin/**`, `/console`,
`AdminApp`, `AdminShellLayout`, model changelists, custom operator screens, or
admin home widgets.

**Architecture source (read first):**
[How admin interfaces are shaped](../../../../docs/explanation/admin-interface.md)
and [Build admin screens](../../../../docs/how-to/build-admin-screens.md).

**Related skills:** `building-terreno-apps` (Expo/`@terreno/ui` habits),
`terreno-ui` (components), `terreno-data-fetching` (windowed syncdb + RPC),
`terreno-backend-api` (`modelRouter` + `admin:`), `verify-ui-changes`.

## Tracer bullet

1. Classify the need: model CRUD, home widget, custom screen, or dedicated workflow
   route. Done when the choice matches the table in `docs/how-to/build-admin-screens.md`.
2. Backend first: `modelRouter({admin})`, `AdminApp.customScreens`, plugin
   `adminContribution()`, or `home.slots`. Done when `GET /admin/config` lists the
   new model or screen for an admin user and omits it without `admin:access`.
3. Frontend wiring: `AdminProvider` + `AdminShellLayout` with matching `apiBase` /
   `routeBase`. Register `widgets.screens[name]` only for host-owned custom screens.
   Done when the sidebar link opens the right component without a missing-widget
   placeholder.
4. Routes: keep `[model]/index.tsx` on `AdminScreenRouter`; `create.tsx` / `[id].tsx`
   on `AdminModelForm`. Add extra Expo files only for extra URL segments. Done when
   no per-model copy of the table exists.
5. UI: `@terreno/ui` + `AdminScreenPage` for custom screens; `color="transparent"`
   inside the shell. String-`_id` models with `adminBroadcast` use windowed
   syncdb; ObjectId/API-only model CRUD uses `useAdminModelApi`; custom RPC uses
   `useAdminRpc` + `useAdminRpcQuery`. All of it goes through the `AdminProvider`
   fetch client. Done when there is no app-owned `fetch`/`axios` and no `api`
   prop on admin components.
6. Verify with `verify-ui-changes` on the example admin or admin-spa. Done when
   home, sidebar, and the new flow are exercised as an admin user.

## References

```
references/
  screens-and-routes.md   File layout, AdminScreenRouter, dedicated routes
  nav-and-shell.md        Sidebar sections, routeBase vs apiBase, mobile drawer
  patterns-and-tools.md   Widgets, platform tools, RBAC, MCP, built-in IDs
```

## Hard guardrails

- Do not hand-roll a DataTable per model. Use `AdminModelTable` / `AdminScreenRouter`.
- Do not put a second sidebar inside a screen. `AdminShell` owns nav.
- Do not pass an `api` prop to admin components (removed in Terreno 58).
  `AdminProvider` (`credentials` for cookie SPAs, `apiOrigin` = `baseUrl` from
  `@terreno/syncdb/config` + `getAuthHeaders` reading the app's
  `authProvider.getToken()` for embedded apps) is the only auth binding.
- Do not invent sidebar entries. Config (filtered by RBAC) is the nav source.
- Do not use `router.back()` as the custom-screen back action; use `AdminScreenPage`.
- Do not edit generated `store/apiSdk.ts` / `store/syncDbSdk.ts` by hand.

## Decision tree

```
Admin work?
  |-- CRUD for a model?
  |   \-- modelRouter admin block; generic [model] routes
  |
  |-- Tile on Home?
  |   \-- home.slots + widgets.home
  |
  |-- Operator page that is not a model?
  |   \-- customScreens.name + widgets.screens[name]
  |
  |-- Extra URL segments or a workflow form cannot express?
  |   \-- Dedicated Expo route; keep the generic table for search
  |
  \-- Done coding?
      \-- verify-ui-changes
```
