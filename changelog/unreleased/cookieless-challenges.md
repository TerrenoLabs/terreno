---
category: Added
---

Two-factor, trusted-device, and passkey sign-in now work for bearer-mode web clients that send no cookies (`createBetterAuthClient({webAuth: "bearer"})`). With `twoFactor` or `passkey` configured, `@terreno/api` copies Better Auth's signed challenge cookies into the `X-Terreno-Auth-Challenge` header for clients that send it and turns the header back into cookies on `/two-factor/*`, `/passkey/*`, and `/sign-in/*`. rtk's bearer mode stores the header beside the bearer token (`${storagePrefix}_auth_challenge`), sends it on those calls, never stores the dead token of a sign-in waiting on a second factor, drops the 2FA challenge after a successful verify and pending challenges on sign-out, and keeps the trusted-device value until it expires. Cookie-mode and native clients are unchanged.
