# Account security reference

`AccountSecurityApp` is a `@terreno/api` plugin that adds per-user security routes for
platform staff and, through `OrgsApp`, for org-admins: a summary of a user's sign-in methods, and recovery actions. Staff can reset
two-factor authentication, remove a passkey, unlink a sign-in provider, sign the user out
everywhere, mail a password reset, disable or enable the account, and issue a set-password link to
a legacy user who has no way to sign in. Every action that changes something writes an
`AuditEvent` with `source: "security"` and emails the affected user
([Notifications](#notifications)). The user's own security changes (linking a provider, turning
on 2FA, changing their password) are recorded and emailed the same way
([Self-service events](#self-service-events)).

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
| `notifications` | `{enabled?, includeOrgName?, throttleMinutes?, render?, sendMail?}` | `{enabled: true, includeOrgName: false, throttleMinutes: 10}` | Security notification emails; see [Notifications](#notifications) |
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

Operators reach a user's Security screen from the user's admin record, so they also need to read
users in the admin panel. The `operator` role holds `user:list` and `user:read`. An app that opts
User into per-model admin access by declaring an `adminUser` statement gates the admin User list and
record on `adminUser` instead, so the `operator` role also gets `adminUser:read` in such an app. It
does not get `write` or `writeOwned`, so an operator can't edit, create, or delete users through the
admin panel. The grant is recorded in `appliedGrants` the same way: an existing `operator` row gains
it once, on the first seed after the app declares `adminUser`, and a revoked grant stays revoked.

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
Each user's permissions are resolved in their own context. On the platform routes both are
resolved outside any organization. On the org-admin routes the actor is resolved under their own
membership in `:orgId` and the target under theirs, so org-scoped grants count for both and a
target is never judged by the acting org-admin's membership.

## Org-admin routes

With organizations on, `OrgsApp` mounts the same handlers at
`/orgs/:orgId/members/:userId/security/*` when the app registers `AccountSecurityApp`
(`TerrenoApp` passes the registered one; pass `accountSecurity` yourself when you register
`OrgsApp` by hand). An app without `AccountSecurityApp` has no `/orgs/*/security` routes. The
instance must be registered too (on the same `TerrenoApp`, in any order, or with `register`
before `OrgsApp` outside one): `OrgsApp` throws `OrgsApp accountSecurity is not registered`
otherwise, because only registration applies the `AuditApp` check, access control, and the user
model.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/orgs/:orgId/members/:userId/security` | Security summary |
| `POST` | `.../reset-two-factor`, `.../revoke-sessions`, `.../send-password-reset` | As on the platform routes |
| `DELETE` | `.../passkeys/:passkeyId`, `.../accounts/:providerId` | As on the platform routes |
| `POST` | `.../suspend-membership` | Org only. Suspend the member's membership in `:orgId` |

The platform-only actions (`disable`, `enable`, `issue-sign-in-link`) are not mounted there. The
org authorizer runs these checks, in order:

| Check | Response |
| --- | --- |
| No session | `401` |
| `:orgId` unknown or not an ObjectId | `404 Organization not found` |
| The organization is disabled | `403 Organization is disabled` |
| The caller is neither platform staff (`user:manageSecurity`) nor an active `org-admin` of `:orgId` | `403 Only org-admins of this organization can manage member security` |
| The target has no active membership in `:orgId` (including a suspended one) | `404 Member not found` |
| Org-admin callers only: the target holds `superadmin` or `operator`, or has `admin: true` | `403 Platform staff are managed by platform staff` |
| Org-admin callers only: the membership is younger than `orgRecovery.minMembershipDays` | `403 Member joined too recently` |

Then the shared steps above apply (self-target and out-of-reach refusals). The target may belong
to other organizations too (D2). Every event records the organization: `after.organizationId` and
the AuditEvent's `organizationId`.

`orgRecovery` is an `OrgsApp` option (`new TerrenoApp({organizations: {orgRecovery:
{minMembershipDays: 7}}})`). It defaults to `0` (off). Set it to stop an org-admin from attaching
an existing user by email and running recovery on them the same day.

### `POST /orgs/:orgId/members/:userId/security/suspend-membership`

Sets the member's `Membership.status` to `suspended` in `:orgId` only (Q8). `User.disabled`, the
user's sessions, and their other memberships are untouched: they still sign in and use their
other organizations. The suspended member is then out of the recovery routes' reach (`404`);
restore them with `PATCH /orgs/:orgId/members/:memberId` and `{status: "active"}`.

| Result | Response |
| --- | --- |
| Suspended | `200 {data: {action: "suspend-membership", changed: true, membershipId, status: "suspended"}}`, one security `AuditEvent` with `after: {membershipId, roleName, securityAction, organizationId}` |
| The member is the org's last active `org-admin` | `400 Cannot remove the last org-admin` |
| Another request suspended the membership first | `200 {data: {..., changed: false}}`, no `AuditEvent` |

The last-org-admin rule holds under concurrency: two org-admins suspending each other at once
never leave the org without one. The action suspends with a conditional update, then counts the
active org-admins left and undoes its own suspension (answering `400`) when none remain. It needs
no transaction, so it works on a standalone MongoDB too.

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
    "actions": [
      {
        "id": "reset-two-factor",
        "label": "Reset two-factor",
        "destructive": true,
        "method": "POST",
        "path": "/reset-two-factor"
      },
      {
        "id": "remove-passkey",
        "label": "Remove passkey",
        "destructive": true,
        "method": "DELETE",
        "path": "/passkeys/:passkeyId"
      }
    ]
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
| `actions` | Recovery actions this server supports and that apply to this user, in display order. Each has `id`, `label`, `destructive`, `method` (`POST` or `DELETE`), and `path` relative to the user's security base, with `:param` placeholders (`/passkeys/:passkeyId`, `/accounts/:providerId`) filled from the summary's items |

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
org-admin prefix, `suspend-membership` takes their place and suspends the org membership
instead; the global flag stays platform-only (Q8).

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
`id`, a `label`, a `destructive` flag (the admin UI confirms destructive actions first), and
its route: `method` and `path` under `.../:userId/security`. A client runs any listed action,
including a custom one, from the summary alone: `{method} {securityBase}{path}`, filling
`:passkeyId` from `passkeys.items[].id` and `:providerId` from `providers[].providerId`.
`@terreno/admin-frontend`'s
[`MemberSecurityPanel`](./admin-frontend.md#membersecuritypanel) renders this list on the
org members screen and on the platform
[`UserSecurityScreen`](./admin-frontend.md#usersecurityscreen), so a new action gets a button
without a frontend change.

| `id` | Label | Destructive | Listed when |
| --- | --- | --- | --- |
| `reset-two-factor` | Reset two-factor | yes | `twoFactor` is on and the user has 2FA enabled |
| `remove-passkey` | Remove passkey | yes | `passkey` is on and the user has at least one passkey |
| `unlink-provider` | Unlink provider | yes | Better Auth is on and the user has at least one linked provider |
| `revoke-sessions` | Sign out everywhere | yes | Better Auth is on and the user has an active session |
| `send-password-reset` | Send password reset | no | Better Auth is on and the user has a Better Auth account |
| `disable` | Disable account | yes | Platform mount only; the User model has `disabled` and the user is enabled |
| `enable` | Enable account | no | Platform mount only; the User model has `disabled` and the user is disabled |
| `suspend-membership` | Suspend membership | yes | Org mount only |
| `issue-sign-in-link` | Issue sign-in link | no | Platform mount only; the caller holds `user:issueSignInLink`; Better Auth is on; the user has no legacy password and either no Better Auth account or one whose link was never used |

Every action name the security log can record, including self-service changes:

| `id` | Started by |
| --- | --- |
| `reset-two-factor`, `remove-passkey`, `unlink-provider`, `revoke-sessions`, `send-password-reset`, `disable`, `enable`, `suspend-membership`, `issue-sign-in-link` | An administrator |
| `provider-linked`, `provider-unlinked`, `passkey-added`, `passkey-removed`, `two-factor-enabled`, `two-factor-disabled`, `password-changed`, `password-set`, `password-reset`, `other-sessions-revoked` | The user (see [Self-service events](#self-service-events)) |

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

## Self-service events

`createBetterAuth` records the security changes a user makes to their own account with
`origin: "self"`, and the user as both actor and target. Each change writes a security
`AuditEvent` when `AuditApp` is registered and reaches every `onSecurityAction` listener. It needs
a `userModel`, because security principals are app User ids. Only successful requests are
recorded. Admin recovery actions change Better Auth data through its adapters, not its endpoints,
so they never show up here twice.

| Action | Recorded when | `after` details |
| --- | --- | --- |
| `provider-linked` | A non-password account is created for a user who already had another sign-in method: `/link-social`, the link callback, the OAuth handoff, or implicit linking on sign-in. A first account is a sign-up and is not recorded | `providerId` |
| `provider-unlinked` | `POST {basePath}/unlink-account` deletes an account | `providerId` |
| `passkey-added` | `POST {basePath}/passkey/verify-registration` succeeds | `passkeyId` |
| `passkey-removed` | `POST {basePath}/passkey/delete-passkey` succeeds | `passkeyId` |
| `two-factor-enabled` | A successful `/two-factor/verify-totp`, `verify-otp`, or `enable` request that turned the stored `twoFactorEnabled` on (enrolment). The 2FA step of a sign-in is not recorded | none |
| `two-factor-disabled` | A successful `POST {basePath}/two-factor/disable` that turned the stored `twoFactorEnabled` off | none |
| `password-changed` | `POST {basePath}/change-password` succeeds | none |
| `password-set` | `POST {basePath}/terreno/set-password` adds a first password | none |
| `password-reset` | `POST {basePath}/reset-password` completes (Better Auth's `onPasswordReset`) | none |
| `other-sessions-revoked` | `POST {basePath}/revoke-other-sessions` succeeds | none |

Two-factor changes are read from the database, not the session. A `user.update.before` database
hook compares the `twoFactorEnabled` being written with the stored user row, so a stale
cookie-cached session cannot hide or invent a change. Admin resets run outside any Better Auth
endpoint, so they are never mistaken for the user's own change.

The plugin is `createSecurityEventsPlugin(userModel)` (id `terreno-security-events`).
`createBetterAuth` adds it next to the app user sync plugin whenever it has a `userModel`.

## Notifications

`AccountSecurityApp` emails the affected user about every recorded security action, both admin
recovery and self-service. It subscribes at registration with `onSecurityAction`. Security
actions are process-wide, so one registration owns the emails: the newest `AccountSecurityApp`
to register replaces any earlier subscription, and two registered apps never email twice.
`accountSecurityApp.unsubscribeNotifications()` stops them on shutdown (it does nothing unless
that instance is the owner).

```typescript
new AccountSecurityApp({
  notifications: {
    enabled: true, // default; nothing is sent while no sendMail is configured
    includeOrgName: false, // default; see below
    throttleMinutes: 10, // default
  },
});
```

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | `false` sends no notification. Recording and audit are unchanged |
| `includeOrgName` | `false` | Name the organization in emails about actions an org-admin ran |
| `throttleMinutes` | `10` | At most one email per user, template, origin (self or admin), and org in this window, so a burst of the same change is one email but an administrator's change is never hidden behind the user's own (D3). Expired entries are pruned as emails go out. `0` sends every one. Every action is still audited |
| `render` | the built-in renderer | Renders the emails instead, for example `@terreno/comms` `renderAuthMail`. See [Templates](#templates) |
| `sendMail` | the registered `BetterAuthApp`'s `sendMail` | Mailer for the notifications. Set it with `setupServer` |

Each email:

- Goes to the target app User's `email`. It is skipped, with no error, when `sendMail` is not
  configured or the user has no email.
- Says who acted: "You" for the user's own changes, or "An administrator" for recovery actions.
  It never gives the admin's name or email.
- Names the organization only when `includeOrgName` is `true` and an org-admin acted ("An
  administrator at Acme Clinic ..."). On a shared inbox the org name can reveal care, so it is
  off by default (Q9).
- Gives the time (UTC) and ends with "If you did not expect this change, contact support right
  away." When `publicAppUrl` is set, it adds "You can review your account security at
  {publicAppUrl}."
- Never includes tokens, links that sign in, passkey names, or other text the user chose. A
  provider is named only when it is a known one (Google, GitHub, Apple, Microsoft, Facebook);
  otherwise the email says "a sign-in provider".

A failed delivery is logged (`Security notification failed action=... userId=...`, never the
address) and never fails the action, and it frees the throttle slot so the next change can still
email. No-op actions (`changed: false`) are not recorded, so they send nothing.

| Action | Template id | Subject |
| --- | --- | --- |
| `reset-two-factor`, `two-factor-disabled` | `securityTwoFactorDisabled` | Two-step verification was turned off |
| `two-factor-enabled` | `securityTwoFactorEnabled` | Two-step verification was turned on |
| `remove-passkey`, `passkey-removed` | `securityPasskeyRemoved` | A passkey was removed from your account |
| `passkey-added` | `securityPasskeyAdded` | A passkey was added to your account |
| `unlink-provider`, `provider-unlinked` | `securityProviderUnlinked` | A sign-in method was disconnected from your account |
| `provider-linked` | `securityProviderLinked` | A sign-in method was connected to your account |
| `revoke-sessions` | `securitySessionsRevoked` | You were signed out everywhere |
| `other-sessions-revoked` | `securityOtherSessionsRevoked` | Your other sessions were signed out |
| `password-changed` | `securityPasswordChanged` | Your password was changed |
| `password-set` | `securityPasswordSet` | A password was added to your account |
| `password-reset` | `securityPasswordReset` | Your password was reset (the body does not say who: anyone holding the link can reset) |
| `disable` | `securityAccountDisabled` | Your account was disabled |
| `enable` | `securityAccountEnabled` | Your account was re-enabled |
| `suspend-membership` | `securityMembershipSuspended` | Your organization membership was suspended |
| `issue-sign-in-link` | `securitySignInLinkIssued` | A sign-in link was created for your account (the link itself went to the administrator and is never in the email; the action refuses users with no email) |
| `send-password-reset` | none | The reset email it sends is the notice; a second email is noise |

### Templates

The built-in renderer renders the emails. `BetterAuthConfig.renderAuthMail` is never used for
them: a renderer written only for `resetPassword`/`verifyEmail` would answer every security id
with a reset or verify mail. To render them yourself, opt in with `notifications.render`; it gets
`{templateId, data, publicAppUrl, templates: authMailTemplates}`. `@terreno/comms`
`renderAuthMail` fits and gives the same output as the built-in renderer. When `render` throws or
returns no subject, the built-in renderer is used and a warning is logged.

Override any template's subject, text, or HTML through `BetterAuthConfig.authMailTemplates`:

```typescript
const betterAuthConfig: BetterAuthConfig = {
  // ...
  authMailTemplates: {
    securityPasswordChanged: {
      subject: "Your Acme password changed",
      text: "{{actor}} changed your password on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
  },
  sendMail: async (message) => getCommsService().sendMail(message),
};

new AccountSecurityApp({notifications: {render: renderAuthMail}}); // optional, from @terreno/comms
```

| Placeholder | Value |
| --- | --- |
| `actor` | `You` or `An administrator` |
| `orgClause` | `""`, or ` at {org name}` with `includeOrgName` |
| `orgReference` | `an organization`, or the org name with `includeOrgName` |
| `providerName` | `Google`, `GitHub`, `Apple`, `Microsoft`, `Facebook`, or `a sign-in provider` |
| `occurredAt` | Such as `October 23, 2026 at 14:05 UTC` |
| `appUrl` | `publicAppUrl` without a trailing slash, or `""` |
| `secureAccountLine` | The "contact support" sentence, with the app URL when set |

HTML bodies get HTML-escaped values, so an org name cannot inject markup. Subject and text get
the raw values.

## Mounting the routes elsewhere

`accountSecurityApp.mountSecurityRoutes(router, authorize, options?)` mounts
`GET /:userId/security` and every action route on any Express router, guarded by `authorize`.
Actions marked `platformOnly` (`disable`, `enable`, `issue-sign-in-link`) are mounted and listed only when
`options.includePlatformOnly` is `true`; the platform routes pass it, other mounts should not.
Actions marked `orgOnly` (`suspend-membership`) are mounted and listed only when
`options.includeOrgOnly` is `true`; the org-admin prefix passes it.

```typescript
type SecurityAuthorizer = (args: {
  req: express.Request;
  targetUserId: string;
}) => Promise<{actor: User; org?: {id: string; name?: string}; orgScope?: SecurityOrgScope}>;
```

`orgScope` (`{organization, actorMembership?, targetMembership}`) makes the reach check resolve
each user under their own membership in that organization. Omit it for routes that are not
org-scoped.

A route action is `{id, method, path, isSupported, isApplicable, run, platformOnly?, orgOnly?,
requiredPermission?}`. `requiredPermission` (such as `{user: ["issueSignInLink"]}`) is checked on
top of the authorizer; without RBAC it requires `admin: true`. An action the caller may not run
answers `403` and is left out of the summary. `run` returns
`{changed, data?, audit?}`: `data` is merged into the response, `audit` into the audit event.

The authorizer throws an `APIError` to refuse: `403` when the caller lacks the right, `404`
when the target is out of their reach. A returned `org` is recorded on each audit event. The
platform routes use `accountSecurityApp.authorizePlatform`. Put a prefix's own params in
`options.pathPrefix` (the org routes pass `/:orgId/members`) so the leaf routes carry them: the
authorizer can read them and the OpenAPI spec documents them as path parameters. A router nested
under a param prefix instead needs `Router({mergeParams: true})`, and OpenAPI then shows the
prefix's params as literal text.

## Exports

| Export | Description |
| --- | --- |
| `AccountSecurityApp` | The plugin |
| `MANAGE_SECURITY_PERMISSION` | `{user: ["manageSecurity"]}` |
| `ISSUE_SIGN_IN_LINK_PERMISSION` | `{user: ["issueSignInLink"]}` |
| `SECURITY_ACTIONS`, `SecurityActionId` | Action names, labels, and origins |
| `recordSecurityAction`, `onSecurityAction` | Record an action; subscribe to actions |
| `createSecurityEventsPlugin`, `recordSelfSecurityAction` | The Better Auth plugin that records self-service events; record one by Better Auth user id |
| `createSecurityNotificationListener`, `SECURITY_NOTIFICATION_TEMPLATES`, `DEFAULT_SECURITY_MAIL_TEMPLATES`, `SECURITY_MAIL_TEMPLATE_IDS`, `renderSecurityMail`, `buildSecurityMailData`, `escapeMailHtml` | Notification listener, the action-to-template map, the default templates, and the built-in renderer |
| `SecurityNotificationsOptions`, `SecurityMailTemplateId`, `SecurityMailRenderer` | Types |
| `createAccountSecurityService` | The summary, reset, credential, and access logic without routes |
| `createOrgSecurityAuthorizer`, `mountOrgSecurityRoutes`, `OrgRecoveryOptions` | The org-admin authorizer and mount that `OrgsApp` uses |
| `suspendMembershipAction` | The org-only `suspend-membership` action |
| `AccountSecuritySummary`, `MountSecurityRoutesOptions`, `SecurityAuthorization`, `SecurityAuthorizer`, `SecurityOrgScope`, `SecurityRouteAction` | Types |

Related: [Recover a locked-out user](../how-to/recover-locked-out-user.md),
[Enable the framework audit log](../how-to/audit-log.md),
[Configure Better Auth](../how-to/configure-better-auth.md).
