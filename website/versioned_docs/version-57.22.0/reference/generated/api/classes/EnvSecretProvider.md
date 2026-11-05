Secret provider that reads secrets from environment variables.
Useful for local development and testing.

Maps secret names to environment variable names by converting to SCREAMING_SNAKE_CASE.
e.g., "openai-api-key" → process.env.OPENAI_API_KEY

## Example

```typescript
const provider = new EnvSecretProvider();
// reads process.env.OPENAI_API_KEY
const key = await provider.getSecret("openai-api-key");
```

## Implements

- [`SecretProvider`](../interfaces/SecretProvider.md)

## Constructors

### Constructor

> **new EnvSecretProvider**(): `EnvSecretProvider`

#### Returns

`EnvSecretProvider`

## Properties

### name

> **name**: `string` = `"env"`

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`name`](../interfaces/SecretProvider.md#name)

## Methods

### getSecret()

> **getSecret**(`secretName`, `_version?`): `Promise`\<`string` \| `null`\>

Resolve a secret from an environment variable. Environment variables have no
versions, so the optional `version` parameter is ignored.

#### Parameters

##### secretName

`string`

##### \_version?

`string`

#### Returns

`Promise`\<`string` \| `null`\>

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`getSecret`](../interfaces/SecretProvider.md#getsecret)
