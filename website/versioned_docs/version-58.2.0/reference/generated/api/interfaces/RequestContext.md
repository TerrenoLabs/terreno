Correlation fields stored in AsyncLocalStorage for the lifetime of a request or job. Every log
line emitted inside the scope is enriched with these. `requestId` is the only required field; the
rest are populated when headers, trace context, or auth supply them.

## Properties

### credential?

> `optional` **credential?**: [`RequestCredential`](../type-aliases/RequestCredential.md)

The credential type that authenticated `userId`. Unset for anonymous requests and jobs.
See [RequestCredential](../type-aliases/RequestCredential.md).

***

### jobId?

> `optional` **jobId?**: `string`

Background job identifier (from `x-job-id` or set via [runWithRequestContext](../functions/runWithRequestContext.md)).

***

### oauthScopes?

> `optional` **oauthScopes?**: `string`[]

Scopes granted to the MCP OAuth access token that authenticated the request. Set only when
`credential` is `oauth`. Terreno does not map scopes to tools; check them in permission code,
for example with `requireOAuthScope`.

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
