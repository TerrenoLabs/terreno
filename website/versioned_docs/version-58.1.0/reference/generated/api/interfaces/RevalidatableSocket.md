Minimal socket shape the sweep needs. Lets tests drive it with a mock.

## Extends

- [`SocketWithDecodedToken`](SocketWithDecodedToken.md)

## Properties

### data?

> `optional` **data?**: [`SocketDataBag`](SocketDataBag.md)

#### Overrides

[`SocketWithDecodedToken`](SocketWithDecodedToken.md).[`data`](SocketWithDecodedToken.md#data)

***

### decodedToken?

> `optional` **decodedToken?**: [`DecodedRealtimeToken`](DecodedRealtimeToken.md)

#### Inherited from

[`SocketWithDecodedToken`](SocketWithDecodedToken.md).[`decodedToken`](SocketWithDecodedToken.md#decodedtoken)

***

### disconnect

> **disconnect**: (`close?`) => `void`

#### Parameters

##### close?

`boolean`

#### Returns

`void`

***

### emit

> **emit**: (`event`, `payload?`) => `void`

#### Parameters

##### event

`string`

##### payload?

`unknown`

#### Returns

`void`

***

### encodedToken?

> `optional` **encodedToken?**: `string`

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
