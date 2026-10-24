Secret provider that delegates to an ordered list of providers, returning the
first non-null result.

A provider that throws is warn-logged (secret name only — never the value) and
resolution falls through to the next provider. This makes it easy to compose a
primary provider with a fallback, e.g. GCP with an environment-variable
fallback:

## Example

```typescript
const provider = new CompositeSecretProvider([
  new GcpSecretProvider({projectId: "my-project"}),
  new EnvSecretProvider(),
]);
const key = await provider.getSecret("openai-api-key");
```

## Implements

- [`SecretProvider`](../interfaces/SecretProvider.md)

## Constructors

### Constructor

> **new CompositeSecretProvider**(`providers`): `CompositeSecretProvider`

#### Parameters

##### providers

[`SecretProvider`](../interfaces/SecretProvider.md)[]

#### Returns

`CompositeSecretProvider`

## Properties

### name

> **name**: `string`

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`name`](../interfaces/SecretProvider.md#name)

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

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`getSecret`](../interfaces/SecretProvider.md#getsecret)
