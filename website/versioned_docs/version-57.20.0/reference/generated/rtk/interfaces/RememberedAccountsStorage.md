Key/value storage the store persists to. Sync (localStorage) and async (SecureStore)
implementations both work; with an async `getItem` the store starts unhydrated.

## Properties

### getItem

> **getItem**: (`key`) => `string` \| `Promise`\<`string` \| `null`\> \| `null`

#### Parameters

##### key

`string`

#### Returns

`string` \| `Promise`\<`string` \| `null`\> \| `null`

***

### removeItem

> **removeItem**: (`key`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### key

`string`

#### Returns

`void` \| `Promise`\<`void`\>

***

### setItem

> **setItem**: (`key`, `value`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### key

`string`

##### value

`string`

#### Returns

`void` \| `Promise`\<`void`\>
