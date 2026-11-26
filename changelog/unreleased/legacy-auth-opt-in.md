---
category: Added
---

`TerrenoApp` takes a `legacyAuth` option. `legacyAuth: false` mounts no Passport and no legacy auth routes, reads no JWT secrets, and makes sockets and MCP refuse legacy JWTs, so a Better Auth app runs on its own; `create-terreno-app` can scaffold one. Omitting the option keeps legacy auth on and logs a warning; the default becomes `false` in Terreno 60.
