---
category: Fixed
---

- Better Auth apps are no longer logged out on their first RTK Query request (#1217). With a registered non-JWT token source, `emptySplitApi` sends no `authorization` header when the token is null, and dispatches `auth/logout` only when a 401 survives one `refresh()` and retry.
