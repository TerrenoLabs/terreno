> **loadFullUserForSocket**(`socket`, `userModel?`): `Promise`\<`void`\>

Load the full user document for a just-authenticated socket and cache it on
`socket.data.fullUser` (D2). Called once at handshake, right after the auth
middleware succeeds; the periodic sweep (D1) refreshes it afterwards. A no-op when
no `userModel` is configured (falls back to the synthetic decoded-token shape via
`getSocketUser`) or the decoded token carries no id (should not happen for a
socket that passed auth, but guarded defensively).

## Parameters

### socket

`Socket`\<`DefaultEventsMap`, `DefaultEventsMap`, `DefaultEventsMap`, `any`\> & `object`

### userModel?

[`UserModel`](../interfaces/UserModel.md)

## Returns

`Promise`\<`void`\>
