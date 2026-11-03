> **isVersionError**(`error`): `boolean`

True for the Mongoose error thrown when an `optimisticConcurrency` save matched no
document (its `__v` filter failed) — i.e. another write landed since the load.
Name-checked rather than `instanceof` for the same ES5-dist reason as
[isExecutorConflictError](isExecutorConflictError.md).

## Parameters

### error

`unknown`

## Returns

`boolean`
