> `const` **Config**: `object`

## Type Declaration

### clearOverrides

> **clearOverrides**: () => `void`

Clears every override. Call from afterEach in tests.

#### Returns

`void`

### clearRegistryForTesting

> **clearRegistryForTesting**: () => `void`

Removes every registered key. Intended for tests.

#### Returns

`void`

### get

> **get**: (`key`) => `string` \| `undefined` = `getString`

Returns the configured string value for `key`, applying the resolution
order documented at the top of this file. Returns `undefined` if no
source supplies a value and no default was registered.

#### Parameters

##### key

`string`

#### Returns

`string` \| `undefined`

### getBoolean

> **getBoolean**: (`key`) => `boolean`

Returns true iff the string value equals "true" (case-insensitive). Mirrors
the existing `process.env.X === "true"` idiom.

#### Parameters

##### key

`string`

#### Returns

`boolean`

### getDefault

> **getDefault**: (`key`) => `string` \| `undefined`

Returns the registered default (if any) for `key`.

#### Parameters

##### key

`string`

#### Returns

`string` \| `undefined`

### getJSON

> **getJSON**: \<`T`\>(`key`) => `T` \| `undefined`

Parses a JSON-encoded config value. Returns undefined if unset; throws on
malformed JSON so misconfiguration fails loud at the call site rather than
producing silent runtime errors later.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### key

`string`

#### Returns

`T` \| `undefined`

### getNumber

> **getNumber**: (`key`) => `number` \| `undefined`

Returns the configured value as a number. Throws if a value is present but
not finite — silent NaN propagation has bitten apps before.

#### Parameters

##### key

`string`

#### Returns

`number` \| `undefined`

### getRegisteredKeys

> **getRegisteredKeys**: () => `string`[]

Returns the registered keys, sorted. Used by the admin UI.

#### Returns

`string`[]

### getRegistration

> **getRegistration**: (`key`) => [`ConfigRegistration`](../interfaces/ConfigRegistration.md) \| `undefined`

Returns the registration metadata for `key`, including secret/description.

#### Parameters

##### key

`string`

#### Returns

[`ConfigRegistration`](../interfaces/ConfigRegistration.md) \| `undefined`

### isRegistered

> **isRegistered**: (`key`) => `boolean`

Returns true if `key` was registered.

#### Parameters

##### key

`string`

#### Returns

`boolean`

### refresh

> **refresh**: () => `Promise`\<`void`\>

Reloads the in-memory cache by invoking the registered env loader. No-op
(clears cache) if no loader has been registered.

#### Returns

`Promise`\<`void`\>

### register

> **register**: (`key`, `registration`) => `void`

Registers a configuration key, its default, and metadata. Re-registration
of the same key throws so duplicates surface at boot.

#### Parameters

##### key

`string`

##### registration?

[`ConfigRegistration`](../interfaces/ConfigRegistration.md) = `{}`

#### Returns

`void`

### setCachedEnv

> **setCachedEnv**: (`env`) => `void`

Replaces the cache directly. Intended for the envConfigurationPlugin and tests.

#### Parameters

##### env

`Record`\<`string`, `string`\> \| `null`

#### Returns

`void`

### setEnvLoader

> **setEnvLoader**: (`loader`) => `void`

Registers a loader that returns the env map (typically backed by an
admin-editable Mongoose document). Called once at app startup before
the first `Config.refresh()`.

#### Parameters

##### loader

(() => `Promise`\<`Record`\<`string`, `string`\>\>) \| `null`

#### Returns

`void`

### setOverride

> **setOverride**: (`key`, `value`) => `void`

Sets an in-process override for `key`. Highest precedence — wins over
the cached env map. Intended for tests and bootstrap helpers.

#### Parameters

##### key

`string`

##### value

`string` \| `undefined`

#### Returns

`void`
