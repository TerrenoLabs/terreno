Secret provider that wraps any provider with an in-memory TTL cache.

Cache entries are keyed by `secretName@version` so that pinned versions are
cached independently. `null` results (secret not found) are cached too, to
avoid hammering the underlying provider for missing secrets. Secret values are
never logged.

Use `clear()` to drop the entire cache (e.g. on rotation) or `clearKey()` to
invalidate a single secret.

## Example

```typescript
const provider = new CachingSecretProvider(
  new CompositeSecretProvider([gcp, env]),
  {ttlMs: 30_000}
);
```

## Implements

- [`SecretProvider`](../interfaces/SecretProvider.md)

## Constructors

### Constructor

> **new CachingSecretProvider**(`provider`, `options?`): `CachingSecretProvider`

#### Parameters

##### provider

[`SecretProvider`](../interfaces/SecretProvider.md)

##### options?

[`CachingSecretProviderOptions`](../interfaces/CachingSecretProviderOptions.md)

#### Returns

`CachingSecretProvider`

## Properties

### name

> **name**: `string`

#### Implementation of

[`SecretProvider`](../interfaces/SecretProvider.md).[`name`](../interfaces/SecretProvider.md#name)

## Methods

### clear()

> **clear**(): `void`

Clears the entire cache. Useful on secret rotation and in tests.

#### Returns

`void`

***

### clearKey()

> **clearKey**(`secretName`, `version?`): `void`

Invalidates a single cached secret by name (and optional version).

#### Parameters

##### secretName

`string`

##### version?

`string`

#### Returns

`void`

***

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
