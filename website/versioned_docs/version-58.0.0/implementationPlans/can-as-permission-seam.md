# `can()` as the permission seam

**Status:** Complete  
**Branch:** `cursor/architecture-ips-a7ec`  
**Owner:** —  
**Created:** 2026-08-24  
**Architecture source:** [rbac-permissions.md](rbac-permissions.md) (Complete — this IP **finishes** `can()` as enforcement, it does not redesign roles/statements)  
**Task list:** [can-as-permission-seam.md](../tasks/can-as-permission-seam.md)  
**Depends on:** [unified-mutation-executors.md](unified-mutation-executors.md) so MCP and REST do not keep two permission forks  
**Related:** shipped `createAccess().can()` and `buildAccessPermissions` / `resolveModelRouterAccess` compiling into `RESTPermissions`

## Goal

When a router has `access` + `accessControl`, transports call `accessControl.can({user, resource, action, doc})` (plus existing scopes/field masks). Stop compiling RBAC into `PermissionMethod[]` and then running `checkPermissions` as the real engine.

Today `resolveModelRouterAccess` in `api/src/rbac/modelRouterAccess.ts` builds legacy `permissions.create/list/...` arrays. `permissionMiddleware` and executors still AND those functions. Apps still pass both `access` and `permissions` (example-backend). The RBAC IP already defined `can()` + `IsPermitted` as the target.

## Non-Goals

- New role/statement/scope/field-view model (already shipped).
- Deleting `Permissions.IsAuthenticated` / `IsOwner` / `RESTPermissions` for routers that have **no** `access` block.
- Redis/cross-process RBAC cache (explicitly out of the completed RBAC IP).
- Admin UI for roles (shipped).
- Collapsing `api/src/rbac/*` files into one file (fails the deletion test).

## Decisions

| Question | Decision |
|----------|----------|
| Interface shape | **A — `can()` is the engine when `access` is set.** `permissionMiddleware` and executors branch: RBAC path calls `can()`; legacy path calls `checkPermissions`. Not B (delete `PermissionMethod` in one cut). |
| `permissions` field | Remains **required on the type** for routers without `access`. When `access` is set, `permissions` may still be present but **must not** be AND-composed with `can()` (that double-gate is the bug). `resolveModelRouterAccess` stops replacing `permissions` with compiled methods for the request path. |
| Empty array = 405 | Preserve: empty `permissions.create` disables create. For `access`, missing action / deny from `can()` is 403 unless the method is not in the access map — map CRUD methods to resource actions as today’s `buildAccessPermissions` does. Disabled method stays 405 when the access config omits that action the same way empty arrays work; document the mapping table in reference docs. |
| Executors | After unified-mutation-executors, one `assertCanWrite(method, …)` used by executors (and thus MCP). Middleware uses the same helper for HTTP load-object-and-check. |
| `IsPermitted` | Keep as the adapter for **custom** routes that are not modelRouter CRUD. |
| Compatibility | Routers with only `permissions:` unchanged. Routers with `access:` may drop redundant `permissions` arrays in example-backend in a follow-up task in this IP. |

## Interface shapes considered

**A (chosen).**

```typescript
assertAllowed({
  method: RESTMethod,
  options: Pick<ModelRouterOptions<T>, "access" | "accessControl" | "permissions">,
  user?: User,
  doc?: T,
}): Promise<void> // throws APIError 403/405
```

Inside: if `options.access && options.accessControl` → `can()`; else `checkPermissions`.

**B (rejected for this slice).** Remove `RESTPermissions` from `ModelRouterOptions`. Forces every consumer to adopt RBAC in one release.

## Architecture

```
Before:
  access → buildAccessPermissions → PermissionMethod[] → checkPermissions
                                                      ↗ executors
                                                      ↗ permissionMiddleware
                                                      ↗ MCP handlers (until unified writes)

After:
  access.can(...)  ← assertAllowed ← HTTP / executors / MCP
  permissions[]    ← assertAllowed   (legacy routers only)
```

Do not call `buildAccessPermissions` on the hot path. It may remain as a deprecated helper for one minor if tests rely on it; contract phase deletes hot-path use.

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/reference/api.md` | Permission evaluation order: `access`+`accessControl` → `can()`; else `permissions` arrays. Dual AND is gone. |
| `docs/how-to/create-a-model.md` | Example with `access` only (plus TerrenoApp-injected `accessControl`). |
| `docs/implementationPlans/rbac-permissions.md` | Pointer: enforcement inversion completed here. |

## Testing

Seam: `assertAllowed` + one modelRouter integration test with `access` that **fails** if compiled `permissions` still AND with a denying extra `Permissions.IsAdmin`.

Cases:

- Legacy router: empty delete array → 405.
- RBAC deny role → 403 with existing reason shape.
- RBAC allow + leftover `permissions: {create: [Permissions.IsAdmin]}` on a non-admin who `can()` create → **allow** (proves no double gate).
- Scope deny still deny.
- MCP write deny uses the same helper (after unified executors).

## Risks

| Risk | Mitigation |
|------|------------|
| 403 vs 405 drift | Table in reference docs; tests per method omitted vs denied. |
| Query filter / field views currently bundled in `resolveModelRouterAccess` | Keep queryFilter and responseHandler injection; only stop compiling permission **methods**. |
| Custom routes using `permissionMiddleware` | Same `assertAllowed` inside middleware so custom CRUD-shaped routes benefit. |

## Phases

1. Add `assertAllowed`; unit tests for legacy vs `can()` vs double-gate.
2. Wire `permissionMiddleware` + executors; delete hot-path `buildAccessPermissions`.
3. example-backend: `access` without redundant AND-permissions where safe. Docs + changelog.

## Feature Flags & Migrations

No flag. Behavior change for apps that set **both** `access` and denying `permissions` expecting AND: they become `can()`-only. Changelog **Breaking** note: `access` wins; remove duplicate `permissions` if you relied on AND.

## Not Included / Future Work

- Making `permissions` optional in the TypeScript type (major).
- External permission sources (already in RBAC module).

## Files to Create / Modify

- `api/src/permissions.ts` or `api/src/rbac/assertAllowed.ts` (prefer small new module next to rbac)
- `api/src/rbac/modelRouterAccess.ts` — stop hot-path compile
- `api/src/api.ts` — `_buildModelRouter` must not require compiled arrays when `access` is set
- `api/src/sync/executors.ts`
- `api/src/rbac/modelRouterAccess.test.ts`, executor and api permission tests
- `example-backend` modelRouters if they dual-specify
- Docs listed above

## Acceptance Criteria

- [ ] With `access`+`accessControl`, `can()` is the only allow/deny engine for CRUD (HTTP + executors).
- [ ] Dual `access` + denying `permissions` does not AND.
- [ ] Legacy `permissions`-only routers unchanged (405 empty array, AND semantics).
- [ ] Query filters and field views from `resolveModelRouterAccess` still apply.
- [ ] Breaking note published for the AND change.
- [ ] Docs match; api tests pass.

## Task List

[docs/tasks/can-as-permission-seam.md](../tasks/can-as-permission-seam.md)
