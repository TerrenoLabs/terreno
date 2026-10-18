## Admin panel frontend

Read the architecture first:

- `docs/explanation/admin-interface.md`
- `docs/how-to/build-admin-screens.md`

Use `AdminProvider` + `AdminShellLayout`. Home is `AdminHome`. Generic models use
`AdminScreenRouter` on `[model]/index` (create is `[model]/create`, not `new`).
Custom screens need the same `name` on `AdminApp.customScreens` and
`widgets.screens`. `AdminProvider` is the only auth binding: every admin request
(model CRUD and RPC) goes through its host-bound `adminRequest` fetch client
(`credentials` for cookie SPAs, `apiOrigin` + `getAuthHeaders` for embedded apps).
String-`_id` model CRUD uses windowed syncdb when `adminBroadcast` is enabled;
ObjectId and API-only models use `useAdminModelApi`. Admin components take no RTK
`api` prop, and admin code never calls `injectEndpoints`.

Agent workflow: skill `building-admin-interfaces`.
