---
category: Changed
---

- The example app has a Security screen at `/settings/security` (`TerrenoAccountSecurityScreen`), opened from the profile's **Security** button (`profile-security-link`). It links and unlinks providers, changes the password through Better Auth's `changePassword`, adds and removes passkeys, turns two-factor on with backup codes, and signs out other sessions. The profile's "New Password" field, which sent `password` to `PATCH /auth/me`, is gone.
- e2e: `account-security.spec.ts` joins the cross-site bearer run. It links the mock OIDC provider and unlinks it (the password still signs in), turns on two-factor and signs in with a saved backup code, adds and removes a passkey through the virtual authenticator, signs out a second browser's session (which then gets 401), and changes the password (the old one is refused, the new one signs in). `profile.spec.ts` opens Security from the profile in the cookie-mode run.
