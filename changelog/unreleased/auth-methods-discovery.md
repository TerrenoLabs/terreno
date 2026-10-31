---
category: Added
---

- `@terreno/api`: every Better Auth server now answers `GET {basePath}/terreno/methods`
  (public, no session) with `{emailPassword, signUp, providers, passkey, twoFactor,
  accountLinking, multiSession}`. `providers` lists the configured Google, GitHub, and Apple
  providers and any `genericOAuth` provider ids. `createBetterAuth` adds the `terreno-methods`
  plugin after `bearer()`, before `config.plugins`.
- `@terreno/syncdb/auth`: `useAuthMethods(authClient)` returns `{methods, isLoading, error}` from that
  endpoint through the client's `$fetch`, so bearer and cookie modes both work.
- example-frontend: the login screen shows only the social providers the server reports, and
  shows the mock OIDC button when the server lists `mock-oidc`.
  `EXPO_PUBLIC_MOCK_OIDC_SIGN_IN` is no longer read.
