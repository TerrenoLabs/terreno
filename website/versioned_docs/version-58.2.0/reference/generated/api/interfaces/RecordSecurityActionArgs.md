## Extended by

- [`SecurityActionEvent`](SecurityActionEvent.md)

## Properties

### action

> **action**: `"disable"` \| `"enable"` \| `"issue-sign-in-link"` \| `"other-sessions-revoked"` \| `"passkey-added"` \| `"passkey-removed"` \| `"password-changed"` \| `"password-reset"` \| `"password-set"` \| `"provider-linked"` \| `"provider-unlinked"` \| `"remove-passkey"` \| `"reset-two-factor"` \| `"revoke-sessions"` \| `"send-password-reset"` \| `"suspend-membership"` \| `"two-factor-disabled"` \| `"two-factor-enabled"` \| `"unlink-provider"`

***

### actor?

> `optional` **actor?**: [`SecurityPrincipal`](SecurityPrincipal.md)

Who acted. Omit only when no user is known (a system job).

***

### details?

> `optional` **details?**: `Record`\<`string`, `unknown`\>

Extra fields for the AuditEvent `after`, such as which passkey or provider. No secrets.

***

### org?

> `optional` **org?**: [`SecurityActionOrg`](SecurityActionOrg.md)

***

### target

> **target**: [`SecurityPrincipal`](SecurityPrincipal.md)

Whose account changed.
