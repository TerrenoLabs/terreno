Per-socket data bag. `fullUser` is populated once at handshake (see
`loadFullUserForSocket` / `RealtimeApp`'s connection handler) by loading the full
Mongoose user document for `decodedToken.id`, and refreshed by D1's periodic
re-validation sweep. When present it is authoritative for authorization (permits
fields like `organizationIds` that the synthetic decoded-token shape never carries
— see D2); the synthetic shape remains a fallback for setups with no `userModel`
configured, or while the handshake load is still in flight.

## Properties

### fullUser?

> `optional` **fullUser?**: `unknown`

The consumer's own Mongoose user document, so its app-specific fields are opaque
here — read it through [getSocketUser](../functions/getSocketUser.md) rather than narrowing it inline.

***

### fullUserLoad?

> `optional` **fullUserLoad?**: `Promise`\<`void`\>

The in-flight handshake load of [SocketDataBag.fullUser](#fulluser), published so handlers
that must not authorize against the synthetic token user can await it
(see awaitSocketFullUser). Never rejects.

***

### syncSubscriptions?

> `optional` **syncSubscriptions?**: `Map`\<`string`, `Set`\<`string`\>\>

Sync collection tag -> joined `sync:{stream}` rooms (see `socketHandlers.ts`).
Lives on the data bag (not the handler closure) so D1's sweep can re-resolve
stream membership and `socket.leave()` rooms no longer held (D4) without needing
access to `installSyncSocketHandlers`'s internal state.
