---
category: Fixed
---

`@terreno/api`: with `BetterAuthApp` registered, the JWT recovery routes no longer give an account without a JWT password one. `POST /auth/forgotPassword` mails no legacy reset link to such an account (it still answers 202, so the response does not reveal the account), and `POST /auth/resetPassword` (and the `POST /resetPassword` alias) refuses its token with 400 `legacy-password-reset-unavailable` and issues no tokens. Before, a social-only account could reset through these routes and then sign in at `POST /auth/login`, which has no second factor. That account resets through Better Auth instead. Accounts that already have a JWT password reset here as before, and apps without Better Auth are unchanged.
