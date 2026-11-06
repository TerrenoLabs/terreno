> **reresolveSyncRoomsForSocket**(`socket`, `options`): `Promise`\<`void`\>

D4: re-resolve the streams the socket's user currently belongs to for every
subscribed collection, and `socket.leave()` any previously-joined sync room the
user no longer holds (e.g. a revoked organization membership). Joins any newly
granted rooms too, mirroring what a fresh `sync:subscribe` would do, so a
membership grant also takes effect without a reconnect.

## Parameters

### socket

[`RevalidatableSocket`](../interfaces/RevalidatableSocket.md)

### options

[`SessionRevalidationOptions`](../interfaces/SessionRevalidationOptions.md)

## Returns

`Promise`\<`void`\>
