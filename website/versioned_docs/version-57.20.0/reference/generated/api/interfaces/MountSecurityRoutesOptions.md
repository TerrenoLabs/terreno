Options for [AccountSecurityApp.mountSecurityRoutes](../classes/AccountSecurityApp.md#mountsecurityroutes).

## Properties

### includeOrgOnly?

> `optional` **includeOrgOnly?**: `boolean`

Mount and list actions marked `orgOnly` (such as `suspend-membership`). Only the org-admin
prefix (`OrgsApp`) sets it.

***

### includePlatformOnly?

> `optional` **includePlatformOnly?**: `boolean`

Mount and list actions marked `platformOnly` (such as `issue-sign-in-link`). Only the
platform mount sets it; org-admin prefixes leave it off.

***

### pathPrefix?

> `optional` **pathPrefix?**: `string`

Path in front of `/:userId/security` on `router`, such as `/:orgId/members`. Put a parent
prefix's params here rather than mounting a nested router under them: OpenAPI documents only
the params in each leaf route's own path.
