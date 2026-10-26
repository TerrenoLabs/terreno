## Properties

### keyBy?

> `optional` **keyBy?**: `"ip"` \| `"user"`

Bucket key. `ip` (default) uses `req.ip`, so set Express `trust proxy` behind a load
balancer. `user` keys by authenticated user id and falls back to IP.

***

### max

> **max**: `number`

Requests allowed per key in each window.

***

### name

> **name**: `string`

Bucket namespace so separate route limits never share counters.

***

### now?

> `optional` **now?**: () => `number`

Test-only clock.

#### Returns

`number`

***

### store?

> `optional` **store?**: `"memory"` \| `"redis"` \| `"mongo"`

Shared backing store. Defaults to `memory` (per process).

***

### storeImpl?

> `optional` **storeImpl?**: [`RateLimitStore`](RateLimitStore.md)

Test-only store override.

***

### windowMs

> **windowMs**: `number`
