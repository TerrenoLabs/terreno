---
category: Added
---

- `@terreno/api` serves `POST {basePath}/terreno/set-password` (`{newPassword}`) so a signed-in user without a password, such as one who signed up with a provider, can add one. It needs a fresh session (403 `SESSION_NOT_FRESH` otherwise) read from the database, refuses with 409 `PASSWORD_ALREADY_SET` when a password exists, follows Better Auth's length rules, and sits in the `auth` rate-limit bucket. With a `userModel`, an app User linked by `betterAuthId` that already has a JWT password gets the new one too, and its `tokenEpoch` is bumped; a social-only account does not gain a JWT password. Two concurrent sets leave one password.
- A successful set records the new `password-set` security event, which emails the user "A password was added to your account" (template `securityPasswordSet`) when security notifications are on.
