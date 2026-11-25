## Properties

### betterAuthBasePath?

> `optional` **betterAuthBasePath?**: `string`

Better Auth `basePath` (default `/api/auth`). Used to classify sign-in,
sign-up, password reset, and OAuth callback routes as the auth bucket.
When omitted, TerrenoApp copies `BetterAuthApp` config.basePath if that plugin is registered.

***

### limits?

> `optional` **limits?**: [`RateLimitLimits`](RateLimitLimits.md)

***

### now?

> `optional` **now?**: () => `number`

Test-only clock.

#### Returns

`number`

***

### redisClient?

> `optional` **redisClient?**: [`RateLimitRedisClient`](RateLimitRedisClient.md)

Test-only Redis client. Production Redis store builds a client from VALKEY_URL / REDIS_URL.

***

### skip?

> `optional` **skip?**: (`req`) => `boolean`

#### Parameters

##### req

`Request`

#### Returns

`boolean`

***

### store?

> `optional` **store?**: `"memory"` \| `"redis"` \| `"mongo"`

***

### storeImpl?

> `optional` **storeImpl?**: [`RateLimitStore`](RateLimitStore.md)

Test-only store override. Production uses `store`.

***

### trustProxy?

> `optional` **trustProxy?**: `string` \| `number` \| `boolean` \| `string`[]
