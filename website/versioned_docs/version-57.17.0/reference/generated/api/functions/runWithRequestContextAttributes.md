> **runWithRequestContextAttributes**\<`T`\>(`attributes?`, `callback`): `T`

Like [runWithRequestContext](runWithRequestContext.md), but seeds the scope from raw header attributes (for example
those received on an incoming message or forwarded by another service). Parses Cloud Trace / W3C
`traceparent` into `traceId`/`spanId` via [getRequestContextFromAttributes](getRequestContextFromAttributes.md).

## Type Parameters

### T

`T`

## Parameters

### attributes?

`Record`\<`string`, `string` \| `undefined`\> = `{}`

### callback

() => `T`

## Returns

`T`
