## Properties

### healthUrl?

> `optional` **healthUrl?**: `string`

URL to poll for server health. Defaults to `${baseUrl}/health`.

***

### offlinePollIntervalMs?

> `optional` **offlinePollIntervalMs?**: `number`

Polling interval in ms while offline. Default 3000.

***

### pollIntervalMs?

> `optional` **pollIntervalMs?**: `number`

Polling interval in ms while online. Default 5000.

***

### skip?

> `optional` **skip?**: `boolean`

Skip polling entirely (e.g. when not authenticated).
