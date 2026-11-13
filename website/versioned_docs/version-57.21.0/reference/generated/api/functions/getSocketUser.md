> **getSocketUser**(`socket`): [`User`](../interfaces/User.md) \| `undefined`

Resolve the authorization-ready user for a socket: the full user document loaded at
handshake (`socket.data.fullUser`, see D2) when available, otherwise the synthetic
`{_id, admin, id, isAnonymous}` shape derived from the decoded token alone. Consumers
(permission checks, `getUserScopes`, delta filters) should always go through this
function rather than reading `decodedToken` directly, so they transparently benefit
once a `userModel` is configured.

## Parameters

### socket

[`SocketWithDecodedToken`](../interfaces/SocketWithDecodedToken.md)

## Returns

[`User`](../interfaces/User.md) \| `undefined`
