> **withCookieJarRepair**(`__namedParameters`): [`StorageAdapter`](../interfaces/StorageAdapter.md)

Wraps a storage adapter so reads of the Better Auth cookie jar are repaired first. Only the
jar key is touched, because the plugin stores unrelated shapes under its other keys (the
cached session payload holds plain strings and numbers, which `repairCookieJar` would strip).

## Parameters

### \_\_namedParameters

#### cookieJarKey

`string`

#### storage

[`StorageAdapter`](../interfaces/StorageAdapter.md)

## Returns

[`StorageAdapter`](../interfaces/StorageAdapter.md)
