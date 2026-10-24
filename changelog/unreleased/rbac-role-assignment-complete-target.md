---
category: Fixed
---

`@terreno/api`: the RoleManager target-privilege rule (`access.roles.assign`, `unassign`, `previewAssignment`, and `assertCanModifyUser`, used by `PUT /rbac/users/:id/roles`, `POST /rbac/users/:id/roles/preview`, and `@terreno/admin-backend` user writes) now resolves the target user with `requireComplete`. Before, when an additive permission source was down, the target's grants from it were dropped, so the target looked less privileged and an actor without those permissions could change its roles. The check now answers 503 `Permission source unavailable` in that case. `createRoleManager` takes an optional `getTargetPermissions` for this.
