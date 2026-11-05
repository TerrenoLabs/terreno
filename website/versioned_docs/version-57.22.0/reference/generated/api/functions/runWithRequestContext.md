> **runWithRequestContext**\<`T`\>(`context`, `callback`): `T`

Runs `callback` inside a fresh correlation scope so every log line it emits shares the same
identifiers — the manual equivalent of [requestContextMiddleware](requestContextMiddleware.md) for background jobs,
cron tasks, scripts, queue consumers, etc. A `requestId` is generated when not supplied, and the
context is mirrored to Sentry.

## Type Parameters

### T

`T`

## Parameters

### context

`Partial`\<[`RequestContext`](../interfaces/RequestContext.md)\>

### callback

() => `T`

## Returns

`T`

## Example

```typescript
import {createScopedLogger, runWithRequestContext} from "@terreno/api";

await runWithRequestContext({jobId: "nightly-sync"}, async () => {
  const log = createScopedLogger({prefix: "[NightlySync]"});
  log.info("started"); // includes jobId + a generated requestId on every line
  await sync();
});
```
