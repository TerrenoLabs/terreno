## Properties

### basePath?

> `optional` **basePath?**: `string`

***

### domain?

> `optional` **domain?**: `string`

OpenFeature domain — must match `<OpenFeatureProvider domain>` on the client.

***

### skip?

> `optional` **skip?**: `boolean`

***

### socket?

> `optional` **socket?**: \{ `off`: (`event`, `handler`) => `void`; `on`: (`event`, `handler`) => `void`; \} \| `null`

Optional socket.io client for live flag refresh.

***

### socketEventName?

> `optional` **socketEventName?**: `string`

***

### userId?

> `optional` **userId?**: `string` \| `null`

Current user id — included in RTK cache key and OpenFeature targeting context.
