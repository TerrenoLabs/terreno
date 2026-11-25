## Properties

### accessTokenTtlSeconds

> **accessTokenTtlSeconds**: `number`

***

### allowedRedirectHosts

> **allowedRedirectHosts**: `string`[]

***

### authorizationCodeTtlSeconds

> **authorizationCodeTtlSeconds**: `number`

***

### authorizationRequestTtlSeconds

> **authorizationRequestTtlSeconds**: `number`

***

### clientIdMetadataDocuments

> **clientIdMetadataDocuments**: \{ `allowedClientIds`: `string`[]; `fetch`: [`McpOAuthMetadataFetch`](../type-aliases/McpOAuthMetadataFetch.md); \} \| `undefined`

Allowlisted CIMD client ids and the fetch to load them, or undefined while off.

***

### consent

> **consent**: `object`

Approval policy, enforced on the consent endpoints, and where consent happens.

#### mode

> **mode**: `"url"` \| `"builtin"`

#### requireAdmin

> **requireAdmin**: `boolean`

#### requireTwoFactor

> **requireTwoFactor**: `boolean`

***

### consentUrl

> **consentUrl**: `string` \| `undefined`

The app's consent page. Undefined in builtin mode without one.

***

### dynamicClientRegistration

> **dynamicClientRegistration**: `boolean`

***

### grants

> **grants**: [`McpOAuthGrant`](McpOAuthGrant.md)[] \| `undefined`

Enforced grants, or undefined while `mcpOAuth.grants` is unset.

***

### issuer

> **issuer**: `string`

***

### refreshTokenTtlSeconds

> **refreshTokenTtlSeconds**: `number`

***

### resource

> **resource**: `string`

***

### resourceMetadataUrl

> **resourceMetadataUrl**: `string`

URL of the RFC 9728 protected-resource metadata for [resource](#resource).

***

### scopesSupported

> **scopesSupported**: `string`[]
