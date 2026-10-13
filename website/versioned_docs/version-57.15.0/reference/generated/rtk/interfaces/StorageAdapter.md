Storage adapter interface matching what Better Auth expects.

## Properties

### getItem

> **getItem**: (`key`) => `string` \| `Promise`\<`string` \| `null`\> \| `null`

#### Parameters

##### key

`string`

#### Returns

`string` \| `Promise`\<`string` \| `null`\> \| `null`

***

### removeItem?

> `optional` **removeItem?**: (`key`) => `void` \| `Promise`\<`void`\>

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
