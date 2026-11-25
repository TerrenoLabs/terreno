> **withApiErrorHandling**\<`T`\>(`fn`, `options`): `Promise`\<`T`\>

Wraps an external API call with standardized error handling: failures are normalized
via normalizeApiError, passed through the optional redactError hook, logged exactly
once, and rethrown.

In "raw" mode (default) the wrapper logs the normalized shape via the injected logger
and rethrows the original error. In "apiError" mode the wrapper throws a terreno
APIError with a stable title (per-occurrence text goes in `detail`) and stays silent
itself — apiErrorMiddleware logs APIErrors, so logging here too would double-log.

## Type Parameters

### T

`T`

## Parameters

### fn

() => `Promise`\<`T`\>

### options

[`WithApiErrorHandlingOptions`](../interfaces/WithApiErrorHandlingOptions.md)

## Returns

`Promise`\<`T`\>
