> **evictExpiredSyncMutationWindows**(`__namedParameters?`): `number`

Drop windows that have expired, so the map does not grow with every user ever seen.
Runs automatically (throttled to WINDOW\_EVICTION\_INTERVAL\_MS) whenever budget is
charged; `now` is injectable so the sweep can be exercised without waiting a minute.
Returns the number of windows still retained.

## Parameters

### \_\_namedParameters?

#### now?

`number` = `...`

## Returns

`number`
