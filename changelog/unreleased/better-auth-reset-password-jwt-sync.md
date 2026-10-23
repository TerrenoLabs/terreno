---
category: Fixed
---

Better Auth's `POST {basePath}/reset-password` no longer answers 500 when the app has a user model. Terreno's JWT password sync re-read a request body Better Auth had already consumed; it now reads the new password from the parsed body of the Better Auth endpoint being served, so the reset succeeds, the app User's passport hash gets the new password, and `tokenEpoch` is bumped. Direct `auth.api.resetPassword` calls and the email-OTP and phone-number resets sync the same way.
