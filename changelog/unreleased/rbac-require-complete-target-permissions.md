---
category: Fixed
---

`@terreno/api`: the account-security reach check (an org-admin or platform operator acting on another user) and the RBAC user-write guard no longer let an actor through because a permission source was down. A failed source drops its grants from the target's resolved permissions, which made the target look less privileged than it is. Both now resolve the target with the new `access.getPermissions({user, requireComplete: true})`, which answers 503 `Permission source unavailable` when a failed source's grants are unknown (grants served from a `"use-stale"` cache still count).
