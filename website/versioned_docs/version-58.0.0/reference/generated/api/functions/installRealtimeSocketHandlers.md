> **installRealtimeSocketHandlers**(`socket`, `options?`): `void`

Install the base socket handlers on a single socket: join the per-user, `authenticated`,
and (for admins) `admin` rooms, and log disconnects. Extracted from the RealtimeApp
connection handler so it can be unit-tested with a mock socket (no real Socket.io /
HTTP server / JWT handshake required).

Collection subscriptions go through the sync protocol (`sync:subscribe`), installed
separately by `installSyncSocketHandlers`.

## Parameters

### socket

[`RealtimeSocketLike`](../interfaces/RealtimeSocketLike.md)

### options?

#### logInfo?

(`msg`) => `void`

## Returns

`void`
