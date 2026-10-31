The subset of a Socket.io socket the validators need. Lets tests pass a stub.

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

### encodedToken?

> `optional` **encodedToken?**: `string`

***

### handshake

> **handshake**: `object`

#### auth

> **auth**: `object`

##### Index Signature

\[`key`: `string`\]: `unknown`

##### auth.token?

> `optional` **token?**: `string`
