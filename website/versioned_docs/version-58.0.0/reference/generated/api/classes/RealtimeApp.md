TerrenoPlugin that hosts Socket.io and the MongoDB change stream watcher for
`@terreno/syncdb`.

Attaches a Socket.io server to the HTTP server created by TerrenoApp.start(),
sets up JWT and/or Better Auth authentication for socket connections, installs the
sync protocol handlers (`sync:subscribe` / `sync:mutate`), and starts a change stream
watcher that emits `sync:delta` events for models registered with `sync`.

## Example

```typescript
const app = new TerrenoApp({
  userModel: User,
  realtime: { debug: true },
})
  .register(todoRouter)   // todoRouter has a `sync` config
  .register(new SyncApp())
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

> **register**(`app`, `_openApi?`, `terrenoApp?`): `void`

Register routes and middleware. Adds a /realtime/health endpoint.

#### Parameters

##### app

`Application`

##### \_openApi?

`unknown`

##### terrenoApp?

[`TerrenoApp`](TerrenoApp.md)

#### Returns

`void`

#### Implementation of

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md).[`register`](../interfaces/TerrenoPlugin.md#register)
