---
category: Fixed
---

Terreno's Better Auth password reset sync to the app User's JWT password now also reads the new password from the parsed body of the Better Auth endpoint being served, so direct `auth.api.resetPassword` calls and the email-OTP and phone-number resets (which send `password`) update the passport hash and bump `tokenEpoch` the same way `POST {basePath}/reset-password` does.
