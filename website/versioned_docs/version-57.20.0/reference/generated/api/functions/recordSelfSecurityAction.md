> **recordSelfSecurityAction**(`__namedParameters`): `Promise`\<`void`\>

Records a security action the user made themselves, by their Better Auth user id. Does nothing
when no app User is linked yet. Never throws: a recording failure is logged.

## Parameters

### \_\_namedParameters

#### action

`"disable"` \| `"enable"` \| `"issue-sign-in-link"` \| `"other-sessions-revoked"` \| `"passkey-added"` \| `"passkey-removed"` \| `"password-changed"` \| `"password-reset"` \| `"password-set"` \| `"provider-linked"` \| `"provider-unlinked"` \| `"remove-passkey"` \| `"reset-two-factor"` \| `"revoke-sessions"` \| `"send-password-reset"` \| `"suspend-membership"` \| `"two-factor-disabled"` \| `"two-factor-enabled"` \| `"unlink-provider"`

#### betterAuthUserId

`string` \| `undefined`

#### details?

`Record`\<`string`, `unknown`\>

#### userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

`Promise`\<`void`\>
