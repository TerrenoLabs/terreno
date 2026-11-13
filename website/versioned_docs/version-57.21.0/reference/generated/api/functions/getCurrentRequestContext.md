> **getCurrentRequestContext**(): [`RequestContext`](../interfaces/RequestContext.md) \| `undefined`

Returns the full [RequestContext](../interfaces/RequestContext.md) for the active AsyncLocalStorage scope, or `undefined`
when called outside any request/job scope. The logger uses this to enrich each line.

## Returns

[`RequestContext`](../interfaces/RequestContext.md) \| `undefined`
