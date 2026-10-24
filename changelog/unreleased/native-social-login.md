---
category: Fixed
---

The example app's native (Android) sign-in now works with the local mock OIDC provider: Better
Auth's Expo authorization proxy refuses plain-http provider URLs, so example-backend serves that
proxy for the mock issuer's origin itself while `MOCK_OIDC_ISSUER` is set. The mock provider takes
`MOCK_OIDC_PORT`, `MOCK_OIDC_ISSUER` and `MOCK_OIDC_REDIRECT_URI`, and
`example-frontend/maestro/native-social-login.yaml` drives the sign-in on an emulator. See the new
"Native" section of `docs/how-to/set-up-social-login.md`.
