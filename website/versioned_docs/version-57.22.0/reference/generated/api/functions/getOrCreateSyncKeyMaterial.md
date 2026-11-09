> **getOrCreateSyncKeyMaterial**(`__namedParameters`): `Promise`\<`string`\>

Return the user's key material, generating it on first call. Race-safe: concurrent
first calls converge on the single persisted value via `$setOnInsert` upsert — a
caller must never receive bytes that were not persisted, or its encrypted store
would be undecryptable by any other session.

## Parameters

### \_\_namedParameters

#### userId

`string`

## Returns

`Promise`\<`string`\>
