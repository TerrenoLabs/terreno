---
category: Added
---

- `AccountSecurityApp` (`@terreno/api`) adds platform account-recovery routes: `GET /users/:id/security` summarizes a user's linked providers, passkeys, 2FA state and remaining backup codes, active sessions, last sign-in, and available actions without exposing any secret, and `POST /users/:id/security/reset-two-factor` turns a locked-out user's 2FA off and forgets their trusted devices. Access needs the new RBAC statement `user:manageSecurity` (held by `superadmin` and `operator`; an existing `operator` role gains it once on the next seed, and a later revocation sticks through the new `RbacRole.appliedGrants`) and the user's own session (JWT or Better Auth session; MCP tokens and any other credential get 403). Acting on yourself, or on someone holding a permission you lack (such as a superadmin), is refused with 403. The plugin refuses to start without `AuditApp` unless you pass `audit: false`. See `docs/reference/account-security.md`.
- `AuditEvent.source` accepts `security`. `recordSecurityAction` writes one security event per recovery action that changes something, and `onSecurityAction` lets in-process listeners react to it.
- `mountSecurityRoutes(router, authorize)` mounts the same handlers under another prefix with its own authorizer, and `TerrenoApp.getAccessControl()` returns the app's RBAC access control.
- The example backend registers `AccountSecurityApp`.
