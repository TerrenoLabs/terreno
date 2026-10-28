Interface for adapters that resolve secret values from external providers.

## Properties

### name

> **name**: `string`

## Methods

### getSecret()

> **getSecret**(`secretName`, `version?`): `Promise`\<`string` \| `null`\>

Resolve a secret value by name. Returns `null` when the secret is not found.

#### Parameters

##### secretName

`string`

The secret identifier (short name or provider-specific path).

##### version?

`string`

Optional version to pin resolution to. Providers that do not
  support versioning (e.g. environment variables) ignore this parameter. When
  omitted, the latest version is resolved.

#### Returns

`Promise`\<`string` \| `null`\>
