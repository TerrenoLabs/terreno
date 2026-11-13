> `const` **SECURITY\_ACTIONS**: `object`

Every security action name. Admin actions are the recovery routes under
`/users/:id/security/*` (and the org-admin prefix); self-service actions are recorded when the
user changes their own sign-in methods.

## Type Declaration

### disable

> `readonly` **disable**: `object`

#### disable.destructive

> `readonly` **destructive**: `true` = `true`

#### disable.label

> `readonly` **label**: `"Disable account"` = `"Disable account"`

#### disable.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### enable

> `readonly` **enable**: `object`

#### enable.destructive

> `readonly` **destructive**: `false` = `false`

#### enable.label

> `readonly` **label**: `"Enable account"` = `"Enable account"`

#### enable.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### issue-sign-in-link

> `readonly` **issue-sign-in-link**: `object`

#### issue-sign-in-link.destructive

> `readonly` **destructive**: `false` = `false`

#### issue-sign-in-link.label

> `readonly` **label**: `"Issue sign-in link"` = `"Issue sign-in link"`

#### issue-sign-in-link.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### other-sessions-revoked

> `readonly` **other-sessions-revoked**: `object`

#### other-sessions-revoked.destructive

> `readonly` **destructive**: `false` = `false`

#### other-sessions-revoked.label

> `readonly` **label**: `"Other sessions signed out"` = `"Other sessions signed out"`

#### other-sessions-revoked.origin

> `readonly` **origin**: `"self"` = `"self"`

### passkey-added

> `readonly` **passkey-added**: `object`

#### passkey-added.destructive

> `readonly` **destructive**: `false` = `false`

#### passkey-added.label

> `readonly` **label**: `"Passkey added"` = `"Passkey added"`

#### passkey-added.origin

> `readonly` **origin**: `"self"` = `"self"`

### passkey-removed

> `readonly` **passkey-removed**: `object`

#### passkey-removed.destructive

> `readonly` **destructive**: `false` = `false`

#### passkey-removed.label

> `readonly` **label**: `"Passkey removed"` = `"Passkey removed"`

#### passkey-removed.origin

> `readonly` **origin**: `"self"` = `"self"`

### password-changed

> `readonly` **password-changed**: `object`

#### password-changed.destructive

> `readonly` **destructive**: `false` = `false`

#### password-changed.label

> `readonly` **label**: `"Password changed"` = `"Password changed"`

#### password-changed.origin

> `readonly` **origin**: `"self"` = `"self"`

### password-reset

> `readonly` **password-reset**: `object`

#### password-reset.destructive

> `readonly` **destructive**: `false` = `false`

#### password-reset.label

> `readonly` **label**: `"Password reset with a link"` = `"Password reset with a link"`

#### password-reset.origin

> `readonly` **origin**: `"self"` = `"self"`

### password-set

> `readonly` **password-set**: `object`

#### password-set.destructive

> `readonly` **destructive**: `false` = `false`

#### password-set.label

> `readonly` **label**: `"Password added"` = `"Password added"`

#### password-set.origin

> `readonly` **origin**: `"self"` = `"self"`

### provider-linked

> `readonly` **provider-linked**: `object`

#### provider-linked.destructive

> `readonly` **destructive**: `false` = `false`

#### provider-linked.label

> `readonly` **label**: `"Sign-in provider linked"` = `"Sign-in provider linked"`

#### provider-linked.origin

> `readonly` **origin**: `"self"` = `"self"`

### provider-unlinked

> `readonly` **provider-unlinked**: `object`

#### provider-unlinked.destructive

> `readonly` **destructive**: `false` = `false`

#### provider-unlinked.label

> `readonly` **label**: `"Sign-in provider unlinked"` = `"Sign-in provider unlinked"`

#### provider-unlinked.origin

> `readonly` **origin**: `"self"` = `"self"`

### remove-passkey

> `readonly` **remove-passkey**: `object`

#### remove-passkey.destructive

> `readonly` **destructive**: `true` = `true`

#### remove-passkey.label

> `readonly` **label**: `"Remove passkey"` = `"Remove passkey"`

#### remove-passkey.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### reset-two-factor

> `readonly` **reset-two-factor**: `object`

#### reset-two-factor.destructive

> `readonly` **destructive**: `true` = `true`

#### reset-two-factor.label

> `readonly` **label**: `"Reset two-factor"` = `"Reset two-factor"`

#### reset-two-factor.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### revoke-sessions

> `readonly` **revoke-sessions**: `object`

#### revoke-sessions.destructive

> `readonly` **destructive**: `true` = `true`

#### revoke-sessions.label

> `readonly` **label**: `"Sign out everywhere"` = `"Sign out everywhere"`

#### revoke-sessions.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### send-password-reset

> `readonly` **send-password-reset**: `object`

#### send-password-reset.destructive

> `readonly` **destructive**: `false` = `false`

#### send-password-reset.label

> `readonly` **label**: `"Send password reset"` = `"Send password reset"`

#### send-password-reset.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### suspend-membership

> `readonly` **suspend-membership**: `object`

#### suspend-membership.destructive

> `readonly` **destructive**: `true` = `true`

#### suspend-membership.label

> `readonly` **label**: `"Suspend membership"` = `"Suspend membership"`

#### suspend-membership.origin

> `readonly` **origin**: `"admin"` = `"admin"`

### two-factor-disabled

> `readonly` **two-factor-disabled**: `object`

#### two-factor-disabled.destructive

> `readonly` **destructive**: `false` = `false`

#### two-factor-disabled.label

> `readonly` **label**: `"Two-factor turned off"` = `"Two-factor turned off"`

#### two-factor-disabled.origin

> `readonly` **origin**: `"self"` = `"self"`

### two-factor-enabled

> `readonly` **two-factor-enabled**: `object`

#### two-factor-enabled.destructive

> `readonly` **destructive**: `false` = `false`

#### two-factor-enabled.label

> `readonly` **label**: `"Two-factor turned on"` = `"Two-factor turned on"`

#### two-factor-enabled.origin

> `readonly` **origin**: `"self"` = `"self"`

### unlink-provider

> `readonly` **unlink-provider**: `object`

#### unlink-provider.destructive

> `readonly` **destructive**: `true` = `true`

#### unlink-provider.label

> `readonly` **label**: `"Unlink provider"` = `"Unlink provider"`

#### unlink-provider.origin

> `readonly` **origin**: `"admin"` = `"admin"`
