---
category: Fixed
---

The MCP server's `terreno_bootstrap` frontend template drops the profile screen's "New Password" field. It sent `password` to `PATCH /auth/me`, which answered 200 and changed nothing; change passwords through Better Auth (`changePassword`, or `TerrenoAccountSecurityScreen` from `@terreno/rtk`).
