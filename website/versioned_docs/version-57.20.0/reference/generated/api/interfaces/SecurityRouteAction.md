One row of the action table: a recovery route and the rules for listing it.

## Properties

### id

> **id**: `"disable"` \| `"enable"` \| `"issue-sign-in-link"` \| `"other-sessions-revoked"` \| `"passkey-added"` \| `"passkey-removed"` \| `"password-changed"` \| `"password-reset"` \| `"password-set"` \| `"provider-linked"` \| `"provider-unlinked"` \| `"remove-passkey"` \| `"reset-two-factor"` \| `"revoke-sessions"` \| `"send-password-reset"` \| `"suspend-membership"` \| `"two-factor-disabled"` \| `"two-factor-enabled"` \| `"unlink-provider"`

***

### isApplicable

> **isApplicable**: (`args`) => `boolean`

Whether the user's current state makes the action worth offering in the summary.

#### Parameters

##### args

###### features

[`AccountSecurityFeatures`](AccountSecurityFeatures.md)

###### org?

[`SecurityActionOrg`](SecurityActionOrg.md)

###### state

[`AccountSecurityState`](../type-aliases/AccountSecurityState.md)

#### Returns

`boolean`

***

### isSupported

> **isSupported**: (`features`) => `boolean`

Whether this server can run it at all. Unsupported actions answer 404.

#### Parameters

##### features

[`AccountSecurityFeatures`](AccountSecurityFeatures.md)

#### Returns

`boolean`

***

### method

> **method**: `"post"` \| `"delete"`

***

### orgOnly?

> `optional` **orgOnly?**: `boolean`

Only org-admin prefixes run it (such as `suspend-membership`, which needs the `org`).
`mountSecurityRoutes` skips it unless the mount passes `includeOrgOnly`, so the platform
`/users` prefix never exposes it.

***

### path

> **path**: `string`

Path under `/:userId/security`, such as `/reset-two-factor` or `/passkeys/:passkeyId`.

***

### platformOnly?

> `optional` **platformOnly?**: `boolean`

Only platform staff may run it. `mountSecurityRoutes` skips it unless the mount passes
`includePlatformOnly`, so org-admin prefixes never expose it.

***

### requiredPermission?

> `optional` **requiredPermission?**: `object`

An RBAC permission the actor needs on top of the route's authorizer, such as
`{user: ["issueSignInLink"]}`. Without RBAC the actor needs `admin: true`. Actions the actor
may not run answer 403 and are left out of the summary.

#### Index Signature

\[`resource`: `string`\]: readonly `string`[]

***

### run

> **run**: (`context`) => `Promise`\<[`SecurityActionResult`](SecurityActionResult.md)\>

#### Parameters

##### context

[`SecurityActionContext`](SecurityActionContext.md)

#### Returns

`Promise`\<[`SecurityActionResult`](SecurityActionResult.md)\>
