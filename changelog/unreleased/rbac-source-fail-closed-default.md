---
category: Breaking
---

`PermissionSource.failClosedWhenDenyUnknown` now defaults to `true`. When a source's `getGrants` fails for a user this process has no last-known deny posture for (a new instance, or the posture was evicted), permission checks throw 503 `Permission source unavailable` instead of resolving local roles without the source's `deny`. Behavior after a successful fetch is unchanged. Add `failClosedWhenDenyUnknown: false` to app sources that never return `deny` (additive-only role or permission mappings) to keep their old outage behavior. The built-in organization membership source already sets it. See [RBAC permission sources](docs/reference/api.md#rbac-permission-sources).
