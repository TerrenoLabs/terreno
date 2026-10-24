---
category: Fixed
---

`@terreno/api`: a Better Auth password reset no longer gives a social-only account a JWT password. `onPasswordReset` now copies the new password to the app User's passport hash only when that User already has one (the same rule as `terreno/set-password` and `change-password`), so an account that signed in only with a provider cannot then sign in at `POST /auth/login`, which has no second factor. A dual-enrolled account still gets its JWT password replaced, and every matching app User's `tokenEpoch` is still bumped, so outstanding JWT refresh tokens and MCP credentials stop working after any reset.
