Logger-shaped object returned by [createScopedLogger](../functions/createScopedLogger.md) and [createFeatureFlaggedLogger](../functions/createFeatureFlaggedLogger.md).
Method signatures match the global [logger](../variables/logger.md) so the three are interchangeable at call sites.

## Properties

### catch

> **catch**: (`e`) => `void`

Log a caught exception. Suitable as a promise handler: `promise.catch(log.catch)`.

#### Parameters

##### e

`unknown`

#### Returns

`void`

***

### debug

> **debug**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### error

> **error**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### info

> **info**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### warn

> **warn**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`
