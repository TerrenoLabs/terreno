---
category: Fixed
---

Request logging redacts credential fields under any key name and at any depth in request bodies and query strings (for example `currentPassword`, `idToken.token`, `client_secret`, `code_verifier`, and OAuth `code`), not only five top-level keys. `TerrenoApp` now honors `loggingOptions.logRequests: false`, which was previously ignored.
