# How admin interfaces are shaped

Prefer existing admin packages over a new dashboard. `@terreno/admin-backend`
exposes `/admin/config` plus per-model CRUD. `@terreno/admin-frontend` renders that
config as a sidebar, home dashboard, tables, and forms. `@terreno/admin-spa` is the
same UI served from the API origin.

Consumer screens are thin routes. They wrap `AdminProvider` + `AdminShellLayout` and
let `AdminHome`, `AdminScreenRouter`, `AdminModelTable`, and `AdminModelForm` do the
work. Hand-write a route only when the generic table/form cannot express the
workflow (consent publish, comms message detail, password-on-create).

## Two hosts

| Host | When to use | Route prefix (`routeBase`) | API prefix (`apiBase`) | Fetch auth |
| --- | --- | --- | --- | --- |
| Embedded (`example-frontend/app/admin`) | Admin lives inside the product Expo app | `"/admin"` | `"/admin"` | `getAuthHeaders` → Bearer, plus `apiOrigin` = RTK `baseUrl` so RPC does not hit the Expo origin |
| Standalone (`@terreno/admin-spa`) | Same-origin console served by `AdminSpaServeApp` | `""` (SPA root; mount is `/console`) | `"/admin"` | `credentials="same-origin"`; empty `getAuthHeaders`; omit `apiOrigin` |

`apiBase` is the HTTP path for `/config` and CRUD. `routeBase` is the Expo Router
prefix the sidebar concatenates onto `/{model.name}` and `/{screen.name}`. Mixing
them puts nav on the wrong URL. Embedded hosts must also set `apiOrigin` (the
backend origin, e.g. `http://localhost:4000`) on `AdminProvider`. Native `fetch`
RPC uses that origin to prefix `/admin/config` and `/rbac/roles`. Do not put the
origin in `apiBase` — that would rewrite in-app navigation.

## Screen kinds

| Kind | Source of truth | Frontend |
| --- | --- | --- |
| Model changelist / form | `modelRouter({admin: ...})` or plugin `adminContribution()` | `AdminScreenRouter` → `AdminModelTable` / `AdminModelForm` (list filters live on `DataTable`, not a side drawer) |
| Custom screen | `AdminApp.customScreens` or plugin `customScreens` (`name` + `displayName`) | Matching `AdminProvider.widgets.screens[name]`, or a dedicated Expo route |
| Platform tool | Built-in (`scripts`, `roles`, `version`, `configuration`, audit log, feature flags, jobs) | Sidebar **Platform** section; visibility from `/admin/config.platformTools` (jobs is lifted from `customScreens`) |
| Home widget | `AdminApp.home.slots` IDs | `AdminProvider.widgets.home` (built-ins already registered) |

`GET /admin/config` is caller-specific. Models and custom screens without read
access are omitted. The sidebar must not invent links the config did not return.

## Navigation chrome

`AdminShell` (via `AdminShellLayout`) always owns the sidebar. Do not add a second
app-level nav inside admin.

Order in the rail:

1. **Home** → `{routeBase}/`
2. **Models** grouped by `admin.group` (ungrouped models land in **General**). Custom screens with `group` render inside the matching group **before** model links for that group. A grouped screen with no models still gets its own group heading.
3. **Screens** — only `customScreens` **without** `group` (plus optional host extras)
4. **Platform** — Scripts (`/__scripts`), Migrations (`/__migrations` when
   `migrations.enabled`), Roles, Version, Audit Log, Feature Flags, Jobs, Configuration

Audit log and Feature Flags are models, but the shell lifts them into Platform so
operators do not hunt for them among business collections. The Platform Audit Log
row is `AuditEvent` when `AuditApp` is registered. `isAuditLogModel` also matches
legacy `AdminAuditLog`, `audit-log`, and `audit-events` names. Jobs is a custom
screen (`name: "jobs"`); the shell lifts it the same way.

Below 768px the rail becomes a hamburger drawer. The main column is a body-style
canvas (`neutral-050`). Nested `Page` screens use `color="transparent"` and
`padding={0}` so cards sit on that canvas. Custom screens wrap content in
`AdminScreenPage`; the back arrow uses `router.push(routeBase)` rather than
`router.back()` because sidebar clicks do not always leave history on web.

## Where code goes

| Concern | Location |
| --- | --- |
| Which models appear | `modelRouter` `admin` block, or plugin `adminContribution()` |
| Extra non-CRUD pages | `AdminApp.customScreens` + `widgets.screens` with the **same** `name`. Optional `group` places the screen in that sidebar group (see **Models** above). |
| Home dashboard composition | `AdminApp.home.slots` |
| Field widgets | `admin.fieldOverrides.widget` + `widgets.fields` |
| Expo files | `app/admin/_layout.tsx` (shell once) or per-route shell in admin-spa |
| Dedicated extra segments (`/comms/:id`) | Explicit Expo files so `[model]/[id]` does not treat them as generic forms |
| Data fetching | REST remains membership/search/sort/pagination. String `_id` models with `adminBroadcast` overlay TinyBase and write through syncdb when the host passes a window client + fetch auth. Framework RPC uses host-bound fetch; ObjectId/API-only CRUD keeps RTK compatibility in Terreno 57. |

## Related

- [Build admin screens](../how-to/build-admin-screens.md)
- [Add a model to the admin](../how-to/admin-add-model.md)
- [Customize the admin home](../how-to/admin-custom-home.md)
- [Add a custom admin field widget](../how-to/admin-custom-widget.md)
- [Admin plugin frontend widgets](admin-plugin-frontend.md)
- [admin-frontend reference](../reference/admin-frontend.md)
- [admin-config reference](../reference/admin-config.md)
