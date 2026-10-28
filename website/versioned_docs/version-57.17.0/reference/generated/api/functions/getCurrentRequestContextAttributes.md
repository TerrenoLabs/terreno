> **getCurrentRequestContextAttributes**(`overrides?`): [`RequestContextAttributes`](../type-aliases/RequestContextAttributes.md)

Serializes the active correlation context into HTTP header attributes (keyed by
[REQUEST\_CONTEXT\_ATTRIBUTE\_NAMES](../variables/REQUEST_CONTEXT_ATTRIBUTE_NAMES.md)) so it can be propagated on outbound requests to other
services, keeping the same `requestId`/`traceId` across service boundaries.

## Parameters

### overrides?

`Partial`\<[`RequestContext`](../interfaces/RequestContext.md)\> = `{}`

## Returns

[`RequestContextAttributes`](../type-aliases/RequestContextAttributes.md)
