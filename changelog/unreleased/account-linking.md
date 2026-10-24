---
category: Breaking
---

- `@terreno/api`: the app `User` claim guard moves before the Better Auth user is created, and
  legacy users can prove ownership with their password. 57.17.0 refused to link an unverified
  Better Auth user to an existing `User` by email, but only after the Better Auth user existed, so
  a later email verification could still hand that user the `User`. Now a Better Auth user claims
  an unlinked `User` only when the email is verified (by the provider), or when the sign-up (or
  email sign-in) password verifies against that `User`'s passport-local-mongoose hash. A refused
  sign-up answers 409 with `code: "VERIFY_EMAIL_TO_USE_ACCOUNT"` ("Verify your email to use this
  account"; OAuth callbacks redirect with that `error`) and creates no Better Auth user, account,
  or verification email. A `User` bound to another Better Auth account is refused before
  creation too, with `code: "ACCOUNT_ALREADY_EXISTS"`. `syncBetterAuthUser` throws `APIError`
  409 with the matching title, and never inserts a duplicate `User`. Emails match ignoring case.
  A refusal reveals that an app `User` has that email (an accepted account-existence signal).
  57.17.0's rules still hold: a verified-email link removes a legacy password the `User` never
  proved and bumps `tokenEpoch`, and `trustEmail` seeds skip the checks.
- `BetterAuthApp` registered without a `userModel` now adopts `TerrenoApp`'s before it creates
  Better Auth (new `adoptUserModel`, called by `TerrenoApp.build()`), so the guard runs whenever
  TerrenoApp's session middleware links app `User`s. The legacy hash check does not touch
  passport's `limitAttempts` counters.
- With a user model, the `terreno-app-user-sync` plugin syncs the app `User` as each Better Auth
  session is created, not only on the first authenticated request, and the OAuth provider id
  fills `oauthProvider`. A password-proven link that fails to save fails the sign-in with 500
  `APP_USER_LINK_FAILED`. `syncBetterAuthUser`'s options gain `password`;
  `seedBetterAuthUser` passes the seed password beside `trustEmail`.
- `accountLinking: {mode: "never"}` (or `options.account.accountLinking.enabled: false`) now
  refuses `POST {basePath}/link-social` with 403 `LINKING_DISABLED` instead of failing at the
  provider callback.
- Migration for JWT apps: users who sign up with their existing password, or sign in with a
  provider that verified their email, link at once. Users with no password hash (GitHub JWT
  sign-in) reset their password through JWT `POST /auth/forgotPassword` first, or sign in with a
  verified provider, so keep the JWT routes mounted during the move. See
  `docs/explanation/account-linking.md`.
