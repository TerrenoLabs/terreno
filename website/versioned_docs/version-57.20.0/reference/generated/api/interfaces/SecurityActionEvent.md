What listeners receive for every recorded security action.

## Extends

- [`RecordSecurityActionArgs`](RecordSecurityActionArgs.md)

## Properties

### action

> **action**: `"disable"` \| `"enable"` \| `"issue-sign-in-link"` \| `"other-sessions-revoked"` \| `"passkey-added"` \| `"passkey-removed"` \| `"password-changed"` \| `"password-reset"` \| `"password-set"` \| `"provider-linked"` \| `"provider-unlinked"` \| `"remove-passkey"` \| `"reset-two-factor"` \| `"revoke-sessions"` \| `"send-password-reset"` \| `"suspend-membership"` \| `"two-factor-disabled"` \| `"two-factor-enabled"` \| `"unlink-provider"`

#### Inherited from

[`RecordSecurityActionArgs`](RecordSecurityActionArgs.md).[`action`](RecordSecurityActionArgs.md#action)

***

### actor?

> `optional` **actor?**: [`SecurityPrincipal`](SecurityPrincipal.md)

Who acted. Omit only when no user is known (a system job).

#### Inherited from

[`RecordSecurityActionArgs`](RecordSecurityActionArgs.md).[`actor`](RecordSecurityActionArgs.md#actor)

***

### details?

> `optional` **details?**: `Record`\<`string`, `unknown`\>

Extra fields for the AuditEvent `after`, such as which passkey or provider. No secrets.

#### Inherited from

[`RecordSecurityActionArgs`](RecordSecurityActionArgs.md).[`details`](RecordSecurityActionArgs.md#details)

***

### occurredAt

> **occurredAt**: `string`

ISO timestamp of when the action was recorded.

***

### org?

> `optional` **org?**: [`SecurityActionOrg`](SecurityActionOrg.md)

#### Inherited from

[`RecordSecurityActionArgs`](RecordSecurityActionArgs.md).[`org`](RecordSecurityActionArgs.md#org)

***

### origin

> **origin**: [`SecurityActionOrigin`](../type-aliases/SecurityActionOrigin.md)

***

### target

> **target**: [`SecurityPrincipal`](SecurityPrincipal.md)

Whose account changed.

#### Inherited from

[`RecordSecurityActionArgs`](RecordSecurityActionArgs.md).[`target`](RecordSecurityActionArgs.md#target)
