A real-time sync event received from the server via WebSocket.
Must be kept in sync with the backend RealtimeEvent in @terreno/api.

## Deprecated

Removed in Terreno 58 with `realtimeList` / `realtimeDocument`.
Syncdb uses `sync:delta` events instead.

## Properties

### ~~collection~~

> **collection**: `string`

Route path used as tag type (e.g. "todos")

***

### ~~data?~~

> `optional` **data?**: `DocumentData`

Serialized document data (omitted for hard deletes)

***

### ~~id~~

> **id**: `string`

Document ID

***

### ~~method~~

> **method**: `"delete"` \| `"create"` \| `"update"`

The CRUD method that triggered this event

***

### ~~model~~

> **model**: `string`

Mongoose model name (e.g. "Todo")

***

### ~~timestamp~~

> **timestamp**: `number`

Epoch milliseconds when the event was generated

***

### ~~updatedFields?~~

> `optional` **updatedFields?**: `string`[]

Fields that were updated (for update events)
