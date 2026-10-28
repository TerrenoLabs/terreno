> **emitPayloadToAuthorizedRoom**(`__namedParameters`): `Promise`\<`void`\>

Generalized authorized-room emitter: iterates the sockets in `room`, runs the per-socket
read-permission check against `fullDocument`, builds the payload per socket (so
responseHandlers can tailor output to the receiving user), and emits `eventName`.

`emitToAuthorizedRoom` (legacy "sync" events) and the sync layer's `sync:delta`
emission both delegate here.

## Parameters

### \_\_namedParameters

#### buildPayload

(`user`) => `unknown`

Build the per-socket payload; a throw drops the emission for that socket only.

#### entry

[`AuthorizedEmitEntry`](../interfaces/AuthorizedEmitEntry.md)

#### eventName

`string`

#### fullDocument

`Record`\<`string`, `unknown`\> \| `undefined`

#### io

`Server`

#### logDebug

(`msg`) => `void`

#### room

`string`

## Returns

`Promise`\<`void`\>
