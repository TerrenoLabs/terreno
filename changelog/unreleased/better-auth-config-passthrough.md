---
category: Added
---

`BetterAuthConfig` takes `options` and `plugins`. `options` passes any other Better Auth option (for example `emailAndPassword.requireEmailVerification`, legacy `password.{hash, verify}`, or `databaseHooks`), deep-merged over Terreno's defaults with arrays replaced and explicit values winning. `plugins` are appended after `bearer()` and mount under `basePath`. Apps no longer need to replace `BetterAuthApp` to reach them. (#1578)
