> `const` **REQUEST\_CONTEXT\_ATTRIBUTE\_NAMES**: `object`

Canonical HTTP header names for each correlation field. Use these to propagate context to
downstream services (pair with [getCurrentRequestContextAttributes](../functions/getCurrentRequestContextAttributes.md)) or to read it from an
incoming request (pair with [getRequestContextFromAttributes](../functions/getRequestContextFromAttributes.md)).

## Type Declaration

### jobId

> `readonly` **jobId**: `"x-job-id"` = `JOB_ID_HEADER`

### requestId

> `readonly` **requestId**: `"x-request-id"` = `"x-request-id"`

### sessionId

> `readonly` **sessionId**: `"x-session-id"` = `SESSION_ID_HEADER`

### spanId

> `readonly` **spanId**: `"x-span-id"` = `SPAN_ID_HEADER`

### traceId

> `readonly` **traceId**: `"x-trace-id"` = `TRACE_ID_HEADER`

### traceParent

> `readonly` **traceParent**: `"traceparent"` = `TRACE_PARENT_HEADER`

### traceSampled

> `readonly` **traceSampled**: `"x-trace-sampled"` = `TRACE_SAMPLED_HEADER`

### userId

> `readonly` **userId**: `"x-user-id"` = `USER_ID_HEADER`
