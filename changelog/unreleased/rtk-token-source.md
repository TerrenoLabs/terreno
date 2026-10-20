---
category: Added
---

- `@terreno/rtk` reads request tokens from one registered token source. Call `setTokenSource(authProvider)` once at startup with the same syncdb `AuthProvider` the app builds for `createSyncDb` (for example `betterAuthAdapter(betterAuthClient)`). `getTokenSource()`, `jwtTokenSource`, and `isJwtTokenSource()` are also exported. Without a registered source, rtk keeps using the JWT tokens in storage, so JWT apps change nothing.
- `emptySplitApi` sends the registered source's token.
