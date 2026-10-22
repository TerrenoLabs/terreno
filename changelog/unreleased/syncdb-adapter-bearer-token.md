---
category: Added
---

`betterAuthAdapter` takes a `getBearerToken` option. When it returns a token, `getToken` uses it without calling `getSession()`; a null, empty or throwing getter falls back to `getSession()` as before. Pair it with `getBetterAuthBearerToken` from `@terreno/syncdb/auth` for web apps in Better Auth bearer mode. `getUserId`, `onAuthChange` and `refresh` are unchanged. See [createSyncDb configuration](docs/reference/syncdb.md#createsyncdb-configuration).
