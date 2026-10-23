# Account security reference

`AccountSecurityApp` is a `@terreno/api` plugin that adds per-user security routes for
platform staff: a summary of a user's sign-in methods and recovery actions such as resetting
two-factor authentication. Every action that changes something writes an `AuditEvent` with
`source: "security"`.

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
| `actions` | `SecurityRouteAction[]` | none | Extra recovery actions, mounted and listed after the built-in ones |
| `accessControl` | `AnyTerrenoAccess` | the TerrenoApp's `accessControl` | RBAC used for the platform routes. Without RBAC, the routes require `admin: true` |
| `audit` | `boolean` | `true` | `false` boots without `AuditApp`. Actions still run and still reach listeners, but nothing is written to the audit log |
| `basePath` | `string` | `"/users"` | Prefix for the platform routes |
| `getBetterAuth` | `() => BetterAuthInstance \| undefined` | the registered `BetterAuthApp`'s instance | Better Auth instance to read from. Required with `setupServer` |
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

`:id` is the app `User` id. An unknown id, or one that is not an ObjectId, returns
`404 User not found`. An action whose Better Auth feature is off on this server (for example
`reset-two-factor` without `twoFactor` in `BetterAuthConfig`) returns
`404 Security action not available`.

### `GET /users/:id/security`

```json
{
  "data": {
    "userId": "665f1c...",
    "betterAuthLinked": true,
    "disabled": false,
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
gets `betterAuthLinked: false`, empty lists, zero counts, `null` times, and no actions.

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

## Actions

The summary's `actions` list and the routes come from one action table. Each action has an
`id`, a `label`, and a `destructive` flag (the admin UI confirms destructive actions first).

| `id` | Label | Destructive | Listed when |
| --- | --- | --- | --- |
| `reset-two-factor` | Reset two-factor | yes | `twoFactor` is on and the user has 2FA enabled |

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

`accountSecurityApp.mountSecurityRoutes(router, authorize)` mounts `GET /:userId/security` and
every action route on any Express router, guarded by `authorize`:

```typescript
type SecurityAuthorizer = (args: {
  req: express.Request;
  targetUserId: string;
}) => Promise<{actor: User; org?: {id: string; name?: string}}>;
```

A route action is `{id, method, path, isSupported, isApplicable, run}`. `run` returns
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
| `SECURITY_ACTIONS`, `SecurityActionId` | Action names, labels, and origins |
| `recordSecurityAction`, `onSecurityAction` | Record an action; subscribe to actions |
| `createAccountSecurityService` | The summary and reset logic without routes |
| `AccountSecuritySummary`, `SecurityAuthorizer`, `SecurityRouteAction` | Types |

Related: [Enable the framework audit log](../how-to/audit-log.md),
[Configure Better Auth](../how-to/configure-better-auth.md).
