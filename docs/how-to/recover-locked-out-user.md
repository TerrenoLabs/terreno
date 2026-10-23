# Recover a locked-out user

Help a user who lost their authenticator, passkey, or social account get back in. Platform
staff use `/users/:id/security`; org-admins use `/orgs/:orgId/members/:userId/security`. Both
run the same handlers, and every change writes a security `AuditEvent`.

## Before you start

1. Register `AuditApp` and `AccountSecurityApp` on the `TerrenoApp`:

   ```typescript
   import {AccountSecurityApp, AuditApp, BetterAuthApp, TerrenoApp} from "@terreno/api";

   new TerrenoApp({accessControl: access, organizations: true, userModel: User})
     .register(new BetterAuthApp({config: betterAuthConfig}))
     .register(new AuditApp())
     .register(new AccountSecurityApp())
     .start();
   ```

2. For `disable` and `enable`, apply `isDisabledPlugin` to the User schema.
3. For `send-password-reset`, set `sendMail` and `publicAppUrl` in `BetterAuthConfig`.
4. For the org path, turn organizations on (`organizations: true`). `TerrenoApp` hands the
   registered `AccountSecurityApp` to `OrgsApp`, which mounts the org routes.

## Who can do what

| Action | Route suffix | Platform staff (`user:manageSecurity`) | Org-admin of the user's org |
| --- | --- | --- | --- |
| Read the summary | `GET /security` | Yes | Yes |
| Reset two-factor | `POST /security/reset-two-factor` | Yes | Yes |
| Remove a passkey | `DELETE /security/passkeys/:passkeyId` | Yes | Yes |
| Unlink a provider | `DELETE /security/accounts/:providerId` | Yes | Yes |
| Sign out everywhere | `POST /security/revoke-sessions` | Yes | Yes |
| Send a password reset | `POST /security/send-password-reset` | Yes | Yes |
| Disable or enable the account | `POST /security/disable`, `/enable` | Yes | No |
| Suspend the membership | `POST /security/suspend-membership` | Through the org path | Yes |
| Issue a sign-in link | `POST /security/issue-sign-in-link` | `superadmin` only (`user:issueSignInLink`) | No |

`superadmin` and `operator` hold `user:manageSecurity`. An org-admin is a user whose active
`Membership` in that org has `roleName: "org-admin"`.

Nobody can act on themselves, or on someone who holds a permission they lack. An org-admin can't
reach platform staff or `admin: true` users, members of other orgs, or suspended members.

## Platform path

Prefix every route with `/users/<userId>`.

1. Read the summary to see the user's sign-in methods and the actions that apply:

   ```bash
   curl -H "Authorization: Bearer $TOKEN" https://api.example.com/users/<userId>/security
   ```

   `data.actions` lists only the actions that apply to this user and that you may run.
2. Run the action that fixes the problem:
   - Lost authenticator: `POST .../reset-two-factor`. The user signs in with their password and
     can enroll again.
   - Lost device with a passkey: `DELETE .../passkeys/<passkeyId>` (ids are in the summary).
   - Lost social account: `DELETE .../accounts/<providerId>`.
   - Stolen device: `POST .../revoke-sessions`.
   - Forgotten password: `POST .../send-password-reset`.
   - Compromised account: `POST .../disable`. Later, `POST .../enable`.
   - Legacy user with no password and no inbox: `POST .../issue-sign-in-link`, then give the
     user the returned link yourself. Only a superadmin can do this.
3. Removing the user's last sign-in method answers `409` unless their email is verified. With a
   verified email, the route also mails a password reset.

## Org path

Prefix every route with `/orgs/<orgId>/members/<userId>`. The user must be an active member of
`<orgId>`. They may belong to other orgs too.

1. Read the summary: `GET /orgs/<orgId>/members/<userId>/security`.
2. Run the same recovery actions as the platform path (2FA, passkey, provider, sessions, reset).
3. To cut the user off from your org, run `POST .../suspend-membership`. It suspends only their
   membership in `<orgId>`. They still sign in and keep their other orgs.
4. To bring a suspended member back, use the membership route:
   `PATCH /orgs/<orgId>/members/<memberId>` with `{"status": "active"}`. A suspended member is out
   of reach of the security routes until then.

To stop an org-admin from attaching an existing user by email and acting on them right away, set
a minimum membership age:

```typescript
new TerrenoApp({
  accessControl: access,
  organizations: {orgRecovery: {minMembershipDays: 7}},
  userModel: User,
});
```

## Check the audit trail

Every change is one `AuditEvent` with `source: "security"`. Org actions carry the org's id in
`organizationId`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.example.com/audit-events?source=security&recordId=<userId>"
```

Related: [Account security reference](../reference/account-security.md),
[How organization tenancy works](../explanation/organizations.md#member-recovery),
[Enable the framework audit log](audit-log.md).
