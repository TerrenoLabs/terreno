> `const` **logger**: `object`

Global application logger. Each method writes through Winston (console/file transports) and, when
`USE_SENTRY_LOGGING=true`, mirrors the line to Sentry with the active request context attached.

Prefer [createScopedLogger](../functions/createScopedLogger.md) when a workflow spans multiple log lines that should share a
prefix or labels.

## Type Declaration

### catch

> **catch**: (`e`) => `void`

#### Parameters

##### e

`unknown`

#### Returns

`void`

### debug

> **debug**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

### error

> **error**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

### info

> **info**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

### warn

> **warn**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

## Example

```typescript
import {logger} from "@terreno/api";

logger.info("Server started", {port: 4000});
logger.warn("Slow query", {ms: 500});
logger.error("Failed to process", {error});
logger.debug("Request details", {body: req.body});

// Convenient `.catch` handler for promises – logs and captures the exception.
await chargeCard(id).catch(logger.catch);
```
