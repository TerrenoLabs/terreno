> **createRouteRateLimitMiddleware**(`options`): (`req`, `res`, `next`) => `Promise`\<`void`\>

Express middleware enforcing a fixed-window limit on a single route, independent of the
global `TerrenoApp` `rateLimit` buckets. Use it for expensive or abuse-prone endpoints
such as uploads.

## Parameters

### options

[`RouteRateLimitOptions`](../interfaces/RouteRateLimitOptions.md)

## Returns

(`req`, `res`, `next`) => `Promise`\<`void`\>
