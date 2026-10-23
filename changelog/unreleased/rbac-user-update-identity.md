---
category: Breaking
---

With RBAC (`accessControl`), changing another user's `email`, `disabled`, `betterAuthId`, `githubId`, or `emailVerified` now requires the new `user:updateIdentity` permission in addition to `user:update`. This applies to modelRouter, sync, MCP, instance actions, and AdminApp `PATCH` and bulk-patch. Writes without it get 403 `Missing user:updateIdentity permission`. Newly seeded `admin` roles include it and `superadmin` gets it through `*`. `seedDefaults` does not update an `admin` role that is already stored, so existing deployments must add `updateIdentity` to that role's `user` actions (for example with `PATCH /rbac/roles/admin`) to keep RBAC admins able to edit user emails and disable users. Legacy `admin: true` users and self-writes are not affected. See [RBAC user identity writes](docs/reference/api.md#rbac-user-identity-writes).
