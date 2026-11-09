> **SocketAuthValidator** = (`socket`) => `Promise`\<`void`\>

A socket auth validator: resolve after populating `socket.decodedToken`, or reject to
let the next validator in the chain try.

## Parameters

### socket

[`AuthenticatableSocket`](../interfaces/AuthenticatableSocket.md)

## Returns

`Promise`\<`void`\>
