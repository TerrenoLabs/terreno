Correlation fields stored in AsyncLocalStorage for the lifetime of a request or job. Every log
line emitted inside the scope is enriched with these. `requestId` is the only required field; the
rest are populated when headers, trace context, or auth supply them.

## Properties

### jobId?

> `optional` **jobId?**: `string`

Background job identifier (from `x-job-id` or set via [runWithRequestContext](../functions/runWithRequestContext.md)).

***

### requestId

> **requestId**: `string`

Stable id shared by all log lines for one request/job; echoed to clients as `X-Request-ID`.

***

### sessionId?

> `optional` **sessionId?**: `string`

Auth session id, resolved from the JWT/Better Auth session or `x-session-id`.

***

### spanId?

> `optional` **spanId?**: `string`

Distributed-tracing span id, parsed from Cloud Trace or W3C `traceparent`.

***

### traceId?

> `optional` **traceId?**: `string`

Distributed-tracing trace id, parsed from Cloud Trace or W3C `traceparent`.

***

### traceSampled?

> `optional` **traceSampled?**: `boolean`

Whether the trace is sampled, per the incoming trace headers.

***

### userId?

> `optional` **userId?**: `string`

Authenticated user id, populated after auth middleware runs.
