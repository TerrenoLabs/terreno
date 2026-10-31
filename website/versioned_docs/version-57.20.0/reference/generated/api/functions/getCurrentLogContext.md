> **getCurrentLogContext**(): `Partial`\<[`RequestContext`](../interfaces/RequestContext.md)\>

Returns the active correlation fields as a plain object (empty when outside a scope). This is the
shape attached to Sentry log attributes and is handy when you need to log or forward the current
context yourself.

## Returns

`Partial`\<[`RequestContext`](../interfaces/RequestContext.md)\>
