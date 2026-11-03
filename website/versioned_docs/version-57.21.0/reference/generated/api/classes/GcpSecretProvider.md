Secret provider that reads secrets from Google Cloud Secret Manager.

Requires `@google-cloud/secret-manager` to be installed.
Resolves short names like "openai-api-key" to the full resource path
`projects/{projectId}/secrets/{secretName}/versions/latest`.

## Example

```typescript
const provider = new GcpSecretProvider({ projectId: "my-project" });
const key = await provider.getSecret("openai-api-key");
```

## Implements

- [`SecretProvider`](../interfaces/SecretProvider.md)

## Constructors

### Constructor

> **new GcpSecretProvider**(`options`): `GcpSecretProvider`

#### Parameters

##### options

[`GcpSecretProviderOptions`](../interfaces/GcpSecretProviderOptions.md)

#### Returns

`GcpSecretProvider`

## Properties

### name

> **name**: `string` = `"gcp"`

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`name`](../interfaces/SecretProvider.md#name)

## Methods

### getSecret()

> **getSecret**(`secretName`, `version?`): `Promise`\<`string` \| `null`\>

Resolve a secret from Google Cloud Secret Manager.

#### Parameters

##### secretName

`string`

A short secret id (e.g. "openai-api-key") or a full
  resource path (e.g. "projects/p/secrets/s" or
  "projects/p/secrets/s/versions/3").

##### version?

`string`

Optional version to resolve when `secretName` is a short id
  (e.g. "3"). Defaults to "latest". Ignored when `secretName` already
  contains an explicit `/versions/...` suffix.

#### Returns

`Promise`\<`string` \| `null`\>

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`getSecret`](../interfaces/SecretProvider.md#getsecret)
