---
category: Fixed
---

A Better Auth session whose app `User` has `disabled: true` no longer authenticates on REST: `req.user` stays unset, so protected routes answer 401, matching JWT and MCP. Better Auth's own routes, such as sign-out, still work. (#1577)
