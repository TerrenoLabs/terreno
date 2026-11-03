Configuration for real-time sync on a modelRouter.
Determines which CRUD methods emit WebSocket events and how they are routed.

## Deprecated

Removed in Terreno 58. Use `sync` on modelRouter with `@terreno/syncdb`.
`RealtimeApp` remains required for sync sockets.

## Properties

### ~~methods~~

> **methods**: (`"delete"` \| `"create"` \| `"update"`)[]

Which CRUD methods should emit real-time sync events

***

### ~~realtimeResponseHandler?~~

> `optional` **realtimeResponseHandler?**: (`doc`, `method`) => `unknown`

Custom serializer for real-time events. Falls back to the modelRouter responseHandler.

#### Parameters

##### doc

`Record`\<`string`, `unknown`\>

##### method

`string`

#### Returns

`unknown`

***

### ~~roomStrategy~~

> **roomStrategy**: `"model"` \| `"owner"` \| `"broadcast"` \| ((`doc`, `method`, `req`) => `string`[])

Strategy for determining which Socket.io rooms receive events.
- 'owner': emit to `user:{doc.ownerId}` room
- 'model': emit to `model:{modelName}` room (clients must subscribe)
- 'broadcast': emit to all authenticated sockets
- function: custom room resolver returning room name(s)
