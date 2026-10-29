---
category: Fixed
---

The MCP server's `terreno_bootstrap` frontend template drops the profile screen's "New Password" field. It sent `password` to `PATCH /auth/me`, which refuses password fields since 57.17.0; change passwords through Better Auth (`changePassword`, or `TerrenoAccountSecurityScreen` from `@terreno/rtk`). The "Current password" field that an email change needs stays.
