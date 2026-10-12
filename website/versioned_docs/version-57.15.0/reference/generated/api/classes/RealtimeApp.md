TerrenoPlugin that provides real-time sync via Socket.io and MongoDB change streams.

Attaches a Socket.io server to the HTTP server created by TerrenoApp.start(),
sets up JWT and/or Better Auth authentication for socket connections, manages room subscriptions
(model, document, and query rooms), and starts a change stream watcher that
emits events to connected clients.

## Subscription types

- **Model rooms**: `subscribe:model` / `unsubscribe:model` — receive all events for a collection
- **Document rooms**: `subscribe:document` / `unsubscribe:document` — receive events for a single document
- **Query rooms**: `subscribe:query` / `unsubscribe:query` — receive events matching a MongoDB query

## Example

```typescript
const app = new TerrenoApp({
  userModel: User,
  realtime: { debug: true },
})
  .register(todoRouter)   // todoRouter has realtime config
  .start();
```

## Implements

- [`TerrenoPlugin`](../interfaces/TerrenoPlugin.md)

## Constructors

### Constructor

> **new RealtimeApp**(`config?`): `RealtimeApp`

#### Parameters

##### config?

[`RealtimeAppOptions`](../interfaces/RealtimeAppOptions.md) = `{}`

#### Returns

`RealtimeApp`

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Gracefully shut down the real-time server.

#### Returns

`Promise`\<`void`\>

***

### getIo()

> **getIo**(): `Server`\<`DefaultEventsMap`, `DefaultEventsMap`, `DefaultEventsMap`, `any`\> \| `null`

Get the Socket.io server instance.

#### Returns

`Server`\<`DefaultEventsMap`, `DefaultEventsMap`, `DefaultEventsMap`, `any`\> \| `null`

***

### onServerCreated()

> **onServerCreated**(`server`): `void`

Called after the HTTP server is created. Sets up Socket.io, auth, rooms,
and starts the change stream watcher.

#### Parameters

##### server

`Server`

#### Returns

`void`

#### Implementation of

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md).[`onServerCreated`](../interfaces/TerrenoPlugin.md#onservercreated)

***

### register()

> **register**(`app`): `void`

Register routes and middleware. Adds a /realtime/health endpoint.

#### Parameters

##### app

`Application`

#### Returns

`void`

#### Implementation of

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md).[`register`](../interfaces/TerrenoPlugin.md#register)
