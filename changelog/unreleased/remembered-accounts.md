---
category: Added
---

`@terreno/syncdb/auth`: `createRememberedAccountsStore({rememberIdentity})` remembers who signed in on
this device and how, for the login screen's "last used" badge and "Continue as" cards. It stores
`{userId, method, lastUsedAt}` in SecureStore on native and localStorage on web, keeps the newest
5, re-reads storage before each change (and follows `storage` events on web) so a stale tab
cannot bring back a forgotten account, and resets on unreadable data. `rememberIdentity` is
required: pass `false` to keep only the method. With `true`, the name, a masked email
(`j***@n***.io`) and an `https://` avatar are stored too, and switching back to `false` scrubs
them on the next load. `useRememberedAccounts(store)` returns `{accounts, lastUsedMethod,
isHydrated, forget, clear}`, and `toLoginAccountOptions()` maps accounts to `@terreno/ui`
`LoginScreen`'s `rememberedAccounts`.
