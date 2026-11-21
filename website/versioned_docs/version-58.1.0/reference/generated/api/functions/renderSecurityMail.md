> **renderSecurityMail**(`__namedParameters`): [`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)

Renders a security notification without `@terreno/comms`, from `templates` or the defaults.
HTML bodies get HTML-escaped values. Matches `renderAuthMail` output for the same input.

## Parameters

### \_\_namedParameters

#### data

`Record`\<`string`, `string`\>

#### templateId

`"securityAccountDisabled"` \| `"securityAccountEnabled"` \| `"securityMembershipSuspended"` \| `"securityOtherSessionsRevoked"` \| `"securityPasskeyAdded"` \| `"securityPasskeyRemoved"` \| `"securityPasswordChanged"` \| `"securityPasswordReset"` \| `"securityPasswordSet"` \| `"securityProviderLinked"` \| `"securityProviderUnlinked"` \| `"securitySessionsRevoked"` \| `"securitySignInLinkIssued"` \| `"securityTwoFactorDisabled"` \| `"securityTwoFactorEnabled"`

#### templates?

`Partial`\<`Record`\<`string`, [`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)\>\>

## Returns

[`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)
