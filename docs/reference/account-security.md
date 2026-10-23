# Account security reference

`AccountSecurityApp` is a `@terreno/api` plugin that adds per-user security routes for
platform staff: a summary of a user's sign-in methods, and recovery actions. Staff can reset
two-factor authentication, remove a passkey, unlink a sign-in provider, sign the user out
everywhere, mail a password reset, disable or enable the account, and issue a set-password link to
a legacy user who has no way to sign in. Every action that changes something writes an
`AuditEvent` with `source: "security"`.

It reads Better Auth's data (`user`, `account`, `session`, `twoFactor`, `passkey`) through
Better Auth's internal adapter, so custom collection names keep working. The app `User` links to
its Better Auth user through `betterAuthId`.

## Plugin

```typescript
import {AccountSecurityApp, AuditApp, BetterAuthApp, TerrenoApp} from "@terreno/api";

new TerrenoApp({accessControl: access, userModel: User})
  .register(new BetterAuthApp({config: betterAuthConfig}))
  .register(new AuditApp())
  .register(new AccountSecurityApp())
  .start();
```

Registration throws `AccountSecurityApp requires AuditApp` unless `AuditApp` is registered on
the same `TerrenoApp` or you pass `audit: false`. Recovery changes who can reach an account, so
the default is to refuse to run without an audit trail.

### Outside TerrenoApp (setupServer)

The plugin reads `AuditApp`, Better Auth, and the user model from the `TerrenoApp` it is
registered on. With `setupServer` there is no `TerrenoApp`, so:

- Register `AuditApp` before `AccountSecurityApp`. The startup check then looks for an
  installed audit recorder instead of a registration.
- Pass `userModel` and `getBetterAuth`. Without `getBetterAuth`, every Better Auth feature reads
  as off: summaries show no sign-in methods and `reset-two-factor` answers 404. The plugin logs one
  warning (`AccountSecurityApp found no Better Auth instance`) the first time this happens.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `actions` | `SecurityRouteAction[]` | none | Extra recovery actions, mounted and listed after the built-in ones. Construction throws `Duplicate security action id` when one reuses another action's `id` |
| `accessControl` | `AnyTerrenoAccess` | the TerrenoApp's `accessControl` | RBAC used for the platform routes. Without RBAC, the routes require `admin: true` |
| `audit` | `boolean` | `true` | `false` boots without `AuditApp`. Actions still run and still reach listeners, but nothing is written to the audit log |
| `basePath` | `string` | `"/users"` | Prefix for the platform routes |
| `getBetterAuth` | `() => BetterAuthInstance \| undefined` | the registered `BetterAuthApp`'s instance | Better Auth instance to read from. Required with `setupServer` |
| `publicAppUrl` | `string` | the registered `BetterAuthApp`'s `publicAppUrl` | App page base for `issue-sign-in-link` URLs (`{publicAppUrl}/resetPassword?token=`). Required with `setupServer` to issue links |
| `userModel` | `UserModel` | the TerrenoApp's `userModel` | App User model. Registration throws without one |

## Permissions

| Caller | Platform routes (`/users/:id/security/*`) |
| --- | --- |
| Holder of `user:manageSecurity` (`superadmin`, `operator`) | Allowed, within the target rules below |
| Any other signed-in user | `403 Access denied` |
| No session | `401` |
| MCP service token (`mcp_`), MCP OAuth token (`mcpat_`), or any credential other than the user's own session | `403 Account security requires your own session` |

`user:manageSecurity` is a Terreno RBAC statement. `superadmin` holds it through `*`. The
`operator` role (seeded with `createAccess({organizations: true})`) holds it. An `operator` row
seeded before the statement existed gains it once, on the next seed; the role records that in
`appliedGrants`, so an admin who later revokes it keeps it revoked. Without `accessControl`, the
routes accept `admin: true` users instead.

`issue-sign-in-link` also needs `user:issueSignInLink` (D11). Only `superadmin` holds it by
default, through `*`; `operator` does not, so an operator gets `403 Access denied` and does not see
the action in the summary. Grant it to another role to delegate it. Without `accessControl`, the
caller needs `admin: true`.

Only the user's own session is accepted: the request must be authenticated by a Terreno JWT or a
Better Auth session (cookie or bearer). Every other credential type is refused, including
delegated agent credentials that belong to an operator.

Each route runs the same steps before its handler:

1. Authorize the caller: `403` without the right. This runs before the target is looked up, so
   a caller without access gets `403` for every id and cannot probe which users exist.
2. Load the target: `404` when it does not exist.
3. Check the target is within reach, else `403`:
   - Acting on yourself is refused (`Use your own security settings to change your account`).
     Your own 2FA, passkeys, and providers belong on your own security screen.
   - A target who holds any permission the caller lacks is refused
     (`Target holds permissions you lack`): a superadmin unless the caller is a superadmin, an
     `admin: true` user unless the caller is one, and under RBAC any role grant the caller does
     not also hold. Recovery can never be used to take over a more privileged account.

Routes mounted with `mountSecurityRoutes` (such as the org-admin prefix) run the same steps.

## Routes

All responses use the `{data: ...}` envelope.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/users/:id/security` | Security summary |
| `POST` | `/users/:id/security/reset-two-factor` | Remove the TOTP secret and backup codes and turn 2FA off |
| `DELETE` | `/users/:id/security/passkeys/:passkeyId` | Remove one of the user's passkeys |
| `DELETE` | `/users/:id/security/accounts/:providerId` | Unlink a sign-in provider (every account the user has with it) |
| `POST` | `/users/:id/security/revoke-sessions` | Sign the user out on every device |
| `POST` | `/users/:id/security/send-password-reset` | Mail the user a password-reset link |
| `POST` | `/users/:id/security/disable` | Set `User.disabled` and sign the user out |
| `POST` | `/users/:id/security/enable` | Clear `User.disabled` |
| `POST` | `/users/:id/security/issue-sign-in-link` | Platform only. Create a Better Auth account for a legacy user and return a set-password link |

`:id` is the app `User` id. An unknown id, or one that is not an ObjectId, returns
`404 User not found`. An action whose Better Auth feature is off on this server (for example
`reset-two-factor` without `twoFactor` in `BetterAuthConfig`, or `remove-passkey` without
`passkey`) returns `404 Security action not available`. So do `disable` and `enable` when the
User model has no `disabled` field (add `isDisabledPlugin`).

### `GET /users/:id/security`

```json
{
  "data": {
    "userId": "665f1c...",
    "betterAuthLinked": true,
    "disabled": false,
    "emailVerified": true,
    "legacyPassword": false,
    "password": true,
    "providers": [{"providerId": "github", "linkedAt": "2026-10-01T12:00:00.000Z"}],
    "passkeys": {
      "count": 1,
      "items": [{"id": "pk_1", "name": "Work laptop", "createdAt": "2026-10-02T09:30:00.000Z"}]
    },
    "twoFactor": {"enabled": true, "backupCodesRemaining": 8},
    "sessions": {"active": 2},
    "lastSignIn": {"method": "github", "at": "2026-10-22T18:04:11.000Z"},
    "actions": [{"id": "reset-two-factor", "label": "Reset two-factor", "destructive": true}]
  }
}
```

| Field | Meaning |
| --- | --- |
| `betterAuthLinked` | The app User has a `betterAuthId` whose Better Auth user exists |
| `disabled` | `User.disabled` |
| `emailVerified` | Better Auth `emailVerified` (`false` without a Better Auth link) |
| `legacyPassword` | The app User has a legacy JWT (passport-local-mongoose) password hash |
| `password` | The user has a Better Auth email and password credential |
| `providers` | Linked OAuth providers, sorted by id. The password credential is reported as `password`, not here |
| `passkeys` | Passkey count and each passkey's id, name, and creation time. Empty when the `passkey` feature is off |
| `twoFactor.enabled` | Better Auth `twoFactorEnabled` (always `false` when the `twoFactor` feature is off) |
| `twoFactor.backupCodesRemaining` | Unused backup codes, or `null` when 2FA is off or Better Auth cannot read them |
| `sessions.active` | Unexpired Better Auth sessions |
| `lastSignIn.method` | Better Auth `lastLoginMethod`. Needs `lastLoginMethod: true` in `BetterAuthConfig` |
| `lastSignIn.at` | Start time of the user's most recent Better Auth session |
| `actions` | Recovery actions this server supports and that apply to this user, in display order |

The summary never contains secrets: no TOTP secret, no backup codes, no session tokens, no
OAuth tokens or provider account ids, and no passkey key material.

A legacy user with no Better Auth link (or a `betterAuthId` whose Better Auth user is gone)
gets `betterAuthLinked: false`, empty lists, zero counts, and `null` times. Its actions are
limited to `disable` or `enable`, and `issue-sign-in-link` when it has no legacy password.

### `POST /users/:id/security/reset-two-factor`

Deletes the user's `twoFactor` row (TOTP secret and backup codes), sets Better Auth
`twoFactorEnabled` to `false`, and forgets every device the user marked as trusted (Better Auth
`verification` rows for that user whose identifier starts with `trust-device-`). The user's next
password sign-in gets no 2FA challenge, and they can enroll again from their own security
screen. A browser that was trusted before the reset is challenged again once they re-enroll.
Sessions are not revoked.

If Better Auth is configured to hash verification identifiers (`verification.storeIdentifier`),
the prefix cannot be matched, so the reset deletes every `verification` row for the user (which
also cancels a pending password reset link) and logs a warning. Rows kept only in Better Auth
`secondaryStorage` are not reached.

| Result | Response |
| --- | --- |
| 2FA was on, half-enrolled (secret stored but never confirmed), or a trusted device existed | `200 {data: {action: "reset-two-factor", changed: true}}`, one security `AuditEvent` |
| Nothing to remove, or the user has no Better Auth link | `200 {data: {action: "reset-two-factor", changed: false}}`, no `AuditEvent` |

A reset that changes nothing is not audited and does not notify listeners, so the user is not
told that an administrator reset something that was never set.

### `DELETE /users/:id/security/passkeys/:passkeyId`

Deletes the passkey with that id (the `id` from the summary's `passkeys.items`), but only when it
belongs to the target. Another user's passkey id gets `404` and is never touched. Sessions are not
revoked. Removing the user's last sign-in method follows the
[last sign-in method rule](#last-sign-in-method).

| Result | Response |
| --- | --- |
| Removed | `200 {data: {action: "remove-passkey", changed: true, passkeyId, passwordResetSent}}`, one security `AuditEvent` with `after: {passkeyId, passkeyName, passwordResetSent, securityAction}` |
| Unknown id, another user's passkey, or a user with no Better Auth link | `404 Passkey not found` |
| `passkey` is off in `BetterAuthConfig` | `404 Security action not available` |
| Last sign-in method and the email is unverified | `409 Cannot remove the last sign-in method` |
| Last sign-in method, email verified, `sendMail` not configured | `409 Password reset email is not configured` |
| Last sign-in method, email verified, `publicAppUrl` not configured | `501 publicAppUrl is required to send recovery mail` (from the mail hook) |

### `DELETE /users/:id/security/accounts/:providerId`

Removes the target's Better Auth `account` rows for `providerId` (such as `github` or
`mock-oidc`). The summary never exposes provider account ids, so a user who linked two accounts
of the same provider loses both; the response's `accountCount` says how many went. The password
(`credential`) account is never removed here: send a password reset instead. Removing the
user's last sign-in method follows the [last sign-in method rule](#last-sign-in-method).

Unlinking does not end sessions the user started with that provider: Better Auth sessions do not
record which method created them, so they cannot be told apart. When the provider account may be
compromised, follow the unlink with `revoke-sessions` to sign the user out everywhere.

| Result | Response |
| --- | --- |
| Unlinked | `200 {data: {action: "unlink-provider", changed: true, providerId, accountCount, passwordResetSent}}`, one security `AuditEvent` with `after: {providerId, accountCount, passwordResetSent, securityAction}` |
| `providerId` is `credential` | `400 The password cannot be unlinked` |
| The user has no account with that provider, or no Better Auth link | `404 Provider not linked` |
| Last sign-in method and the email is unverified | `409 Cannot remove the last sign-in method` |
| Last sign-in method, email verified, `sendMail` not configured | `409 Password reset email is not configured` |
| Last sign-in method, email verified, `publicAppUrl` not configured | `501 publicAppUrl is required to send recovery mail` (from the mail hook) |

### `POST /users/:id/security/revoke-sessions`

Deletes every Better Auth session the user has, including each account a multi-session browser
holds. When the User model has `tokenEpoch`, it is also bumped, so legacy JWT refresh tokens stop
working. JWT access tokens stay valid until they expire (default 15 minutes).

| Result | Response |
| --- | --- |
| Sessions deleted, or `tokenEpoch` bumped | `200 {data: {action: "revoke-sessions", changed: true, revokedCount, jwtRefreshRevoked}}`, one security `AuditEvent` with `after: {revokedCount, jwtRefreshRevoked, securityAction}` |
| No sessions and no `tokenEpoch` | `200 {data: {..., changed: false, revokedCount: 0}}`, no `AuditEvent` |

`revokedCount` counts the unexpired sessions that were deleted.

#### Revocation delay for cookie sessions

A bearer client (native apps, bearer-mode web, socket handshakes) sends the session token
itself, and Better Auth looks it up on every request. Its next request after a revoke gets `401`.

A cookie client can keep working for up to 5 minutes. Terreno turns on Better Auth's session
cookie cache (`session.cookieCache`, `maxAge: 300`), which lets the browser's signed
`session_data` cookie stand in for the database lookup until it expires. Revoking cannot reach
that cookie. This trade-off is accepted (Q7): turning the cache off costs a database read on every
request. To close the window, set `options: {session: {cookieCache: {enabled: false}}}` in
`BetterAuthConfig`. `disable` has no such window: the disabled check reads the app User on every
request, whichever way the session resolved.

### `POST /users/:id/security/send-password-reset`

Mails the user a Better Auth password-reset link through `BetterAuthConfig.sendMail`. It uses the
same template, `{publicAppUrl}/resetPassword?token=` link, and lifetime
(`resetPasswordTokenExpiresIn`, default 1 hour) as a self-service reset. Better Auth's
`/reset-password` endpoint consumes the token once. Sessions are not revoked until the user
resets the password; Better Auth then revokes them (`revokeSessionsOnPasswordReset`).

| Result | Response |
| --- | --- |
| Mailed | `200 {data: {action: "send-password-reset", changed: true, sent: true}}`, one security `AuditEvent` |
| `sendMail` not configured | `501 Password reset email is not configured` |
| `publicAppUrl` not configured | `501 publicAppUrl is required to send recovery mail` (from the mail hook) |
| The user has no Better Auth account | `409 User has no Better Auth account` (use `issue-sign-in-link`) |

### `POST /users/:id/security/disable` and `.../enable`

`disable` sets `User.disabled` to `true` and then revokes every session as `revoke-sessions`
does. A disabled user is refused everywhere:

- REST: a Better Auth session for a disabled user does not set `req.user`, so protected routes
  answer `401`; a JWT gets `401 User is disabled`. Better Auth's own routes (sign-in, sign-out)
  still answer, so the user can sign in, but the new session authenticates nothing.
- Sockets: `RealtimeApp`'s Better Auth handshake validator refuses the session
  (`Unauthorized: user is disabled`), and its revalidation sweep disconnects open sockets.

`enable` sets `User.disabled` to `false`. The user signs in again as usual.

| Result | Response |
| --- | --- |
| `disable` changed the flag | `200 {data: {action: "disable", changed: true, revokedCount, jwtRefreshRevoked}}`, one security `AuditEvent` with `after: {revokedCount, jwtRefreshRevoked, securityAction}` |
| `enable` changed the flag | `200 {data: {action: "enable", changed: true}}`, one security `AuditEvent` |
| Already disabled (or enabled) | `200 {data: {..., changed: false}}`, no `AuditEvent` |
| The User model has no `disabled` field | `404 Security action not available` |

Apply `isDisabledPlugin` to the User schema to enable both. Both are platform only:
`mountSecurityRoutes` leaves them out unless the mount passes `includePlatformOnly`. Under the
org-admin prefix, "disable" suspends the org membership instead; the global flag stays
platform-only (Q8).

### `POST /users/:id/security/issue-sign-in-link`

Needs `user:issueSignInLink` (see [Permissions](#permissions)). For a legacy User with no Better
Auth account and no password (for example a GitHub-JWT user, or one whose sign-up was refused for
an unverified email): creates their Better Auth user, links it through `betterAuthId`, and returns
a single-use set-password link for the administrator to hand over. The user opens it, sets a password through Better Auth's `/reset-password`, and signs in to
the same app User.

```json
{
  "data": {
    "action": "issue-sign-in-link",
    "changed": true,
    "url": "https://app.example.com/resetPassword?token=...",
    "expiresAt": "2026-10-23T19:00:00.000Z"
  }
}
```

- The link is a Better Auth password-reset token: it works once and expires after
  `resetPasswordTokenExpiresIn` (default 1 hour).
- A link that was never used can be issued again, for example after it expired. Reissuing is
  allowed only while the linked Better Auth user still looks like one this action created: no
  account rows (no password, no provider), no passkey, and an unverified email. It mints a fresh
  token for the same Better Auth user and deletes the user's earlier reset tokens, so only the
  newest link works. (When Better Auth hashes verification identifiers, earlier links stay valid
  until they expire, and a warning is logged.) Once the user has set a password, the account is
  live and further requests get `409`. The URL is the
  same page the reset mail opens, `{publicAppUrl}/resetPassword?token=`.
- The URL is returned only to the administrator. It is never mailed, logged, or written to the
  audit event, which records `{betterAuthId, expiresAt}`.
- The Better Auth email stays unverified (`emailVerified: false`). The administrator hands the
  link over, so nothing proves the user controls the inbox. If the app sets
  `requireEmailVerification`, the user must verify the email before signing in.
- The Better Auth user is created without Better Auth's `user.create` hooks, because Terreno's
  sign-up guard refuses exactly this case: an unverified user whose email matches an unclaimed
  app User. An administrator vouching for the user is what makes it safe here.
- It is platform only. `mountSecurityRoutes` leaves it out unless the mount passes
  `includePlatformOnly`, so org-admin prefixes never expose it.

| Result | Response |
| --- | --- |
| Issued | `200 {data: {action, changed: true, url, expiresAt}}`, one security `AuditEvent` |
| `publicAppUrl` not configured | `501 Sign-in links are not configured` |
| The caller lacks `user:issueSignInLink` | `403 Access denied` |
| The user has a Better Auth account that has a sign-in method or a verified email (or was linked concurrently) | `409 User already has a Better Auth account` (use `send-password-reset`) |
| The user has a legacy password | `409 User already has a password` (signing in with it links the account) |
| Another Better Auth user already has the email | `409 Email already belongs to another sign-in account` |
| The user has no email | `409 User has no email` |

A `betterAuthId` whose Better Auth user no longer exists counts as unlinked: the link replaces it.

### Last sign-in method

Recovery must not lock a user out. Before `remove-passkey` or `unlink-provider` runs, the route
counts the sign-in methods the user would have left: their remaining accounts (including the
password) plus their passkeys. Passkeys count only when `passkey` is on, because otherwise they
cannot sign in. When none would remain:

- If the user's Better Auth email is not verified, the action is refused with `409`.
- If it is verified, the route first mails a password-reset link through
  `BetterAuthConfig.sendMail`, then removes the method. The link uses the same template and
  `publicAppUrl` link as a self-service reset, and is valid for Better Auth's
  `resetPasswordTokenExpiresIn`. The user sets a password from the link and signs in with it.
  The response and audit event say `passwordResetSent: true`.
- If the reset mail cannot be sent, nothing is removed.

Two recovery actions running at once can each see the other's method and both remove theirs.
So after removing, the route counts again. If nothing is left and no reset went out yet, it
mails one when the email is verified (and reports `passwordResetSent: true`). If the email is
unverified, or that late mail fails, the action still succeeds, reports
`passwordResetSent: false`, and logs an error. If the method was removed by the other request
before this one could, the route answers `404`. Any reset it already mailed is still audited, as
a `send-password-reset` event with `after: {providerId | passkeyId, reason: "last-sign-in-method"}`.

## Actions

The summary's `actions` list and the routes come from one action table. Each action has an
`id`, a `label`, and a `destructive` flag (the admin UI confirms destructive actions first).

| `id` | Label | Destructive | Listed when |
| --- | --- | --- | --- |
| `reset-two-factor` | Reset two-factor | yes | `twoFactor` is on and the user has 2FA enabled |
| `remove-passkey` | Remove passkey | yes | `passkey` is on and the user has at least one passkey |
| `unlink-provider` | Unlink provider | yes | Better Auth is on and the user has at least one linked provider |
| `revoke-sessions` | Sign out everywhere | yes | Better Auth is on and the user has an active session |
| `send-password-reset` | Send password reset | no | Better Auth is on and the user has a Better Auth account |
| `disable` | Disable account | yes | Platform mount only; the User model has `disabled` and the user is enabled |
| `enable` | Enable account | no | Platform mount only; the User model has `disabled` and the user is disabled |
| `issue-sign-in-link` | Issue sign-in link | no | Platform mount only; the caller holds `user:issueSignInLink`; Better Auth is on; the user has no legacy password and either no Better Auth account or one whose link was never used |

Every action name the security log can record, including self-service changes:

| `id` | Started by |
| --- | --- |
| `reset-two-factor`, `remove-passkey`, `unlink-provider`, `revoke-sessions`, `send-password-reset`, `disable`, `enable`, `issue-sign-in-link` | An administrator |
| `provider-linked`, `provider-unlinked`, `passkey-added`, `passkey-removed`, `two-factor-enabled`, `two-factor-disabled`, `password-changed` | The user |

`SECURITY_ACTIONS` exports the full table with labels.

## Audit events

`recordSecurityAction({action, actor, target, org?, details?})` writes one `AuditEvent`. An
action handler's `audit` result becomes `details` (for example, which passkey was removed);
`securityAction` and `organizationId` always come from the framework and cannot be overridden.
`details` must not hold secrets.

| Field | Value |
| --- | --- |
| `source` | `"security"` |
| `modelName` | `"User"` |
| `recordId` | Target app User id |
| `actorId` | Acting app User id |
| `verb` / `operation` | `"updated"` / `"update"` |
| `after` | `{...details, securityAction, organizationId?}` |
| `organizationId` | Set when an org-admin acted for an org |

The write follows the audit recorder's rules: the HTTP handler does not wait for it, and a failed
write is logged without failing the action. Filter the log with
`GET /audit-events?source=security&recordId=<userId>`.

`onSecurityAction(listener)` subscribes to every recorded action and returns an unsubscribe
function. Listeners receive the record plus `occurredAt` (ISO time) and `origin`
(`"admin"` or `"self"`). A listener that throws is logged and never fails the action.

## Mounting the routes elsewhere

`accountSecurityApp.mountSecurityRoutes(router, authorize, options?)` mounts
`GET /:userId/security` and every action route on any Express router, guarded by `authorize`.
Actions marked `platformOnly` (`disable`, `enable`, `issue-sign-in-link`) are mounted and listed only when
`options.includePlatformOnly` is `true`; the platform routes pass it, other mounts should not.

```typescript
type SecurityAuthorizer = (args: {
  req: express.Request;
  targetUserId: string;
}) => Promise<{actor: User; org?: {id: string; name?: string}}>;
```

A route action is `{id, method, path, isSupported, isApplicable, run, platformOnly?,
requiredPermission?}`. `requiredPermission` (such as `{user: ["issueSignInLink"]}`) is checked on
top of the authorizer; without RBAC it requires `admin: true`. An action the caller may not run
answers `403` and is left out of the summary. `run` returns
`{changed, data?, audit?}`: `data` is merged into the response, `audit` into the audit event.

The authorizer throws an `APIError` to refuse: `403` when the caller lacks the right, `404`
when the target is out of their reach. A returned `org` is recorded on each audit event. The
platform routes use `accountSecurityApp.authorizePlatform`. A router mounted under a prefix with
its own params needs `Router({mergeParams: true})` so the authorizer can read them.

## Exports

| Export | Description |
| --- | --- |
| `AccountSecurityApp` | The plugin |
| `MANAGE_SECURITY_PERMISSION` | `{user: ["manageSecurity"]}` |
| `ISSUE_SIGN_IN_LINK_PERMISSION` | `{user: ["issueSignInLink"]}` |
| `SECURITY_ACTIONS`, `SecurityActionId` | Action names, labels, and origins |
| `recordSecurityAction`, `onSecurityAction` | Record an action; subscribe to actions |
| `createAccountSecurityService` | The summary, reset, credential, and access logic without routes |
| `AccountSecuritySummary`, `MountSecurityRoutesOptions`, `SecurityAuthorizer`, `SecurityRouteAction` | Types |

Related: [Enable the framework audit log](../how-to/audit-log.md),
[Configure Better Auth](../how-to/configure-better-auth.md).
