> **createScopedLogger**(`options?`): [`ScopedLogger`](../interfaces/ScopedLogger.md)

Creates a [ScopedLogger](../interfaces/ScopedLogger.md) that prefixes every message and/or attaches stable `labels` to
every line, so multi-step workflows are easy to group and search.

- `prefix` is prepended to the human-readable message (easy grep / Log Explorer text search) and
  also stored as the Winston metadata field `terrenoLogPrefix`.
- `labels` are normalized to strings and stored as the Winston metadata field `terrenoLabels`.
  They appear in the plain-text ` key=value` suffix (see [formatLogContextSuffix](formatLogContextSuffix.md)) and as
  discrete fields on structured transports such as `@google-cloud/logging-winston`.

Both ride on a Winston **child logger**, so they merge with — and never overwrite — the
request/job correlation fields that AsyncLocalStorage injects (`requestId`, `userId`,
`terrenoRequestLog`, etc.). Avoid label keys that collide with those framework fields:
`requestId`, `jobId`, `sessionId`, `userId`, `traceId`, `spanId`, `terrenoLogPrefix`,
`terrenoRequestLog`, `terrenoLabels`.

If both `prefix` and `labels` are empty, the global [logger](../variables/logger.md) is returned unchanged.

## Parameters

### options?

[`CreateScopedLoggerOptions`](../interfaces/CreateScopedLoggerOptions.md) = `{}`

Optional `prefix` token and/or `labels` dimensions for this scope.

## Returns

[`ScopedLogger`](../interfaces/ScopedLogger.md)

A scoped logger sharing the same methods as the global [logger](../variables/logger.md).

## See

[createFeatureFlaggedLogger](createFeatureFlaggedLogger.md) to gate a scoped logger behind a feature flag.

## Example

**Reuse one instance for a whole workflow so every line shares identifiers**

```typescript
import {createScopedLogger} from "@terreno/api";

const log = createScopedLogger({
  prefix: "[InvoicePay]",
  labels: {invoiceId: invoice._id.toString(), attempt: String(attemptNumber)},
});

log.info("Starting capture");        // -> "[InvoicePay] Starting capture invoiceId=... attempt=1 requestId=..."
log.warn("Stripe rate limited, backing off");
await capture(invoice).catch(log.catch);
```
