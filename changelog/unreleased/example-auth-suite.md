---
category: Added
---

- example-backend turns on every Better Auth feature: account linking (`AUTH_ACCOUNT_LINKING`, default `verified-email`), sign-up mode (`AUTH_SIGN_UP`, default `open`), two-factor (issuer "Terreno Example"), passkeys (origin from `FRONTEND_URL`, rpID from `PASSKEY_RP_ID` or the `FRONTEND_URL` host; off in production while `FRONTEND_URL` is a loopback URL), last-used method, multi-session, and native sign-in. `GET /api/auth/terreno/methods` reports them. Seeded users (`seedBetterAuthUserInProcess` and the e2e setup) get a verified Better Auth email, and seeding still works with `AUTH_SIGN_UP=closed`. See [Auth features in example-backend](docs/how-to/configure-better-auth.md#auth-features-in-example-backend).
- The e2e mock OIDC provider can sign in any email, verified or not, per browser context with `setMockOidcIdentity(context, {email, emailVerified})` (or a `login_hint`). `playwright.config.ts` lists the cross-site bearer specs in `CROSS_SITE_SPEC_FILES`, and the new `e2e/authMethods.spec.ts` checks the discovery endpoint there.
