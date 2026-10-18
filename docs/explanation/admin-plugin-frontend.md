# Admin plugin frontend widgets

Screen layout, sidebar order, and host wiring: [How admin interfaces are
shaped](admin-interface.md) and [Build admin screens](../how-to/build-admin-screens.md).

Backend plugins contribute stable widget IDs through `adminContribution()`. Their React
implementations ship from `@terreno/admin-frontend`, under `src/widgets/`.

This keeps the first-party integration in one frontend package and avoids making backend-only
packages depend on React Native. The built-in registry includes consent field widgets, feature
flag home widgets, and Documents/AI Requests/AI Observability/Comms custom screens. Hosts can
override any ID through `AdminProvider.widgets`.

Third-party plugins should publish their own frontend package and ask the host to spread its
registry into `AdminProvider`; `@terreno/admin-frontend` only owns first-party Terreno widgets.

## Authorization metadata

Opening the admin UI is a separate decision from what an operator may do inside it. The page
gate is `admin:access` (`GET /admin/config` 403 without it). Host apps should hide admin
navigation with the same check (`canOpenAdminPage` from `@terreno/rtk`).

`AdminApp` then resolves authorization before returning `/admin/config`. The response only contains
models and custom screens the caller may read, includes effective write capabilities, and exposes
visibility flags for built-in Platform tools. The frontend treats this metadata as navigation and
affordance guidance; backend model, script, configuration, and RBAC routes enforce the same
permissions independently.

Standard model permissions are intentionally three-level (`read`, `write`, `writeOwned`) so roles
remain understandable as the number of admin models grows. Model configuration supplies the
ownership predicate because ownership is domain-specific (`ownerId`, `staffId`, tenant membership,
or another relationship). A custom authorization callback remains available for policies that
cannot be represented by those levels.
