> **installRealtimeSocketHandlers**(`socket`, `options?`): `void`

Install the realtime subscription handlers on a single socket. Extracted from the
RealtimeApp connection handler so this logic can be unit-tested with a mock socket
(no real Socket.io / HTTP server / JWT handshake required).

Enforces:
  - per-socket subscription caps (DoS protection)
  - registry membership (only realtime-enabled collections can be subscribed)
  - owner-strategy isolation (non-admin users cannot subscribe to other users' rooms)
  - server-side queryId computation (clients can't hijack queries by colliding ids)

## Parameters

### socket

[`RealtimeSocketLike`](../interfaces/RealtimeSocketLike.md)

### options?

#### logInfo?

(`msg`) => `void`

## Returns

`void`
