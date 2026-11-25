# Tasks: `can()` as the permission seam

IP: [can-as-permission-seam.md](../implementationPlans/can-as-permission-seam.md)

## Phase 1 — `assertAllowed`

- [x] **Task 1.1**: Helper + unit tests
  - Delivers: `assertAllowed` implements legacy `checkPermissions` and `accessControl.can()`; double-gate test (access allow + permissions deny → allow)
  - Files: `api/src/rbac/assertAllowed.ts`, `api/src/rbac/assertAllowed.test.ts`
  - Blocked by: none (can land before MCP adapters; executors wiring waits on unified writes if MCP still duplicates checks)
  - Acceptance: bun tests cover 405 empty array, 403 can() deny, legacy AND, access-wins-over-permissions

## Phase 2 — Hot path

- [x] **Task 2.1**: Middleware + executors
  - Delivers: `permissionMiddleware` and `executeCreate/Update/Delete` call `assertAllowed`; `buildAccessPermissions` not used on requests
  - Files: `api/src/permissions.ts`, `api/src/sync/executors.ts`, `api/src/api.ts`, `api/src/rbac/modelRouterAccess.ts`, tests
  - Blocked by: 1.1; unified-mutation-executors Phase 2 so MCP is included automatically
  - Acceptance: modelRouter + executor + MCP permission tests pass; grep shows no request-path `buildAccessPermissions`

## Phase 3 — Consumers and docs

- [x] **Task 3.1**: example-backend dual config
  - Delivers: routers with `access` drop redundant AND `permissions` where RBAC is the intent
  - Files: `example-backend/src/**` model routers
  - Blocked by: 2.1
  - Acceptance: example-backend tests pass
- [x] **Task 3.2**: Docs + breaking changelog
  - Files: `docs/reference/api.md`, `docs/how-to/create-a-model.md`, `docs/implementationPlans/rbac-permissions.md` pointer, changelog
  - Blocked by: 2.1
  - Skills: `update-docs`
  - Acceptance: evaluation order is documented; 403 vs 405 table exists
