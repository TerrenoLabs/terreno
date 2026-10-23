---
category: Changed
---

- create-terreno-app: generated frontends register the syncdb Better Auth adapter from `store/syncdb.ts` with `setTokenSource` before the store is built, and the generated SDK uses `@terreno/rtk`'s `emptySplitApi` (`openapi-config.ts` `apiFile: "@terreno/rtk"`). `store/betterAuthApi.ts` and its forked base query are no longer generated. Generated web clients still use Better Auth's session cookie. RTK requests now get rtk's retries, and a 401 that survives one session refresh signs the user out (`auth/logout`); the fork never did. To move an existing generated app over: export `authProvider` from `store/syncdb.ts`, call `setTokenSource(authProvider)` in `store/index.ts`, set `apiFile: "@terreno/rtk"` in `openapi-config.ts`, run `bun run sdk`, delete `store/betterAuthApi.ts`, and import `useGetVersionCheckQuery` from `@terreno/rtk` if the app used it.
