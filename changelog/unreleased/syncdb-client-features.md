---
category: Added
---

`@terreno/syncdb/auth`: `createBetterAuthClient({features})` adds the Better Auth client plugins for the
server's auth features: `twoFactor` (`twoFactorClient`, with `onTwoFactorRedirect`), `passkey`
(`passkeyClient` from `@better-auth/passkey/client`), `multiSession`, `lastLoginMethod` and
`oneTimeToken`. Each enabled feature's namespace is typed without casts (`client.twoFactor.enable`,
`client.passkey.addPasskey`, `client.multiSession.listDeviceSessions`, ...), and the plugins run
after the Expo plugin on native. Without `features` (or with a config whose type does not name
them) the client and its type are unchanged. In web bearer mode `multiSession` lists no
sessions, and 2FA and passkey challenges still need cookies. New types:
`BetterAuthClientFeatures`, `BetterAuthClientWithFeatures`, `BetterAuthClientFor`,
`BetterAuthHandoffClient`.
`BetterAuthOAuthProvider` now accepts any generic OAuth provider id, the OAuth handoff helpers
accept clients with features, and `BetterAuthClientInterface` accepts the stricter session types
those clients return, so they work with `SessionProvider`, which now stores a missing
user `image` as `null`.
