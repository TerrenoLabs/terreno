---
category: Fixed
---

`@terreno/api`: a recovery action that changes something (such as `suspend-membership` under `/orgs/:orgId/members/:userId/security`) now clears the target's cached permissions, so a suspended org-admin loses `admin:access` at once instead of keeping it for up to the 30-second permission cache TTL.
