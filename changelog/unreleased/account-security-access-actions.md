---
category: Added
---

- `AccountSecurityApp` adds access recovery routes under `/users/:id/security`: `revoke-sessions` deletes every Better Auth session (bearer clients get 401 on their next request; cookie sessions can survive up to Better Auth's 5-minute cookie cache) and bumps `tokenEpoch` when the User model has it; `send-password-reset` mails a reset link (501 without `sendMail` or `publicAppUrl`, 409 for a user with no Better Auth account); `disable` sets `User.disabled` and revokes sessions, and `enable` clears it (both need `isDisabledPlugin`). Each change is audited.
- `POST /users/:id/security/issue-sign-in-link` creates a Better Auth account for a legacy User with no Better Auth link and no password, links it by `betterAuthId`, and returns a single-use set-password link `{url, expiresAt}` for the administrator to hand over. The email stays unverified. A link that was never used can be issued again (the earlier one stops working). It needs the new RBAC statement `user:issueSignInLink`, which only `superadmin` holds by default (`admin: true` without RBAC).
- Security route actions can be marked `platformOnly` (`disable`, `enable`, and `issue-sign-in-link` are) and can name a `requiredPermission`. `mountSecurityRoutes(router, authorize, {includePlatformOnly})` leaves platform-only actions out unless asked, so org-admin prefixes never expose them.
- The security summary reports `emailVerified` and `legacyPassword`, and `AccountSecurityApp` takes a `publicAppUrl` option (defaulting to the registered `BetterAuthApp`'s).
- The example backend's User applies `isDisabledPlugin`, so its admin and security screens can disable accounts.
