Minimal shape this module requires from a Socket.io socket. Matches
`RealtimeSocketLike` structurally so tests can drive handlers with a mock socket.

## Extends

- [`SocketWithDecodedToken`](SocketWithDecodedToken.md)

## Properties

### data?

> `optional` **data?**: [`SocketDataBag`](SocketDataBag.md)

#### Inherited from

[`SocketWithDecodedToken`](SocketWithDecodedToken.md).[`data`](SocketWithDecodedToken.md#data)

***

### decodedToken?

> `optional` **decodedToken?**: [`DecodedRealtimeToken`](DecodedRealtimeToken.md)

#### Inherited from

[`SocketWithDecodedToken`](SocketWithDecodedToken.md).[`decodedToken`](SocketWithDecodedToken.md#decodedtoken)

***

### emit

> **emit**: (`event`, `payload`) => `void`

#### Parameters

##### event

`string`

##### payload

`unknown`

#### Returns

`void`

***

### id

> **id**: `string`

***

### join

> **join**: (`room`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### room

`string`

#### Returns

`void` \| `Promise`\<`void`\>

***

### leave

> **leave**: (`room`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### room

`string`

#### Returns

`void` \| `Promise`\<`void`\>

***

### on

> **on**: (`event`, `handler`) => `void`

#### Parameters

##### event

`string`

##### handler

(...`args`) => `void` \| `Promise`\<`void`\>

#### Returns

`void`
