> **isExecutorConflictError**(`error`): `error is ExecutorConflictError`

Duck-typed guard for [ExecutorConflictError](../classes/ExecutorConflictError.md). The package compiles to ES5, where
TypeScript's emit for classes extending built-ins (Error) breaks the prototype chain, so
`instanceof` returns false for consumers running the compiled dist (bun running the TS
source directly is unaffected — which is why unit/integration tests never caught it).
Always use this guard instead of `instanceof ExecutorConflictError`.

## Parameters

### error

`unknown`

## Returns

`error is ExecutorConflictError`
