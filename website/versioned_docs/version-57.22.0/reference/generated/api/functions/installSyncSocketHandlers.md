> **installSyncSocketHandlers**(`_io`, `socket`, `options?`, `handlerOptions?`): `void`

Install the sync socket handlers on a single socket. Wired into RealtimeApp's
connection handler alongside `installRealtimeSocketHandlers`.

The `_io` server parameter is accepted for signature symmetry with future fan-out
needs; the current handlers only act on the connecting socket.

## Parameters

### \_io

`Server`\<`DefaultEventsMap`, `DefaultEventsMap`, `DefaultEventsMap`, `any`\> \| `null`

### socket

[`SyncSocketLike`](../interfaces/SyncSocketLike.md)

### options?

[`SyncAppOptions`](../interfaces/SyncAppOptions.md) = `{}`

### handlerOptions?

#### logInfo?

(`msg`) => `void`

## Returns

`void`
