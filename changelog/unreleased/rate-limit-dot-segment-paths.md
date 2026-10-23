---
category: Fixed
---

The `TerrenoApp` rate limiter resolves `.`/`..` path segments (including `%2e` forms) before choosing a bucket, so dot-segment variants of Better Auth sign-in, sign-up, and password-reset paths are charged to the auth bucket, and dot-segment paths no longer get the health/openapi/swagger skip.
