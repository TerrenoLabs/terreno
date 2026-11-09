## Properties

### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `undefined`\>

Workflow-specific dimensions merged into Winston metadata as `terrenoLabels` (plain-text
suffix and structured jsonPayload on cloud transports). Avoid keys that collide with
request context or scoped metadata: requestId, jobId, sessionId, userId, traceId, spanId,
terrenoLogPrefix, terrenoRequestLog, terrenoLabels.

***

### prefix?

> `optional` **prefix?**: `string`

Short, stable token prepended to every message (for grep and log Explorer text search).
