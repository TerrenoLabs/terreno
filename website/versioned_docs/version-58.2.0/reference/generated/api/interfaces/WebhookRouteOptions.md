## Properties

### eventId?

> `optional` **eventId?**: (`req`) => `string`

#### Parameters

##### req

`Request`

#### Returns

`string`

***

### handler

> **handler**: (`context`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### context

[`WebhookHandlerContext`](WebhookHandlerContext.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### path

> **path**: `string`

***

### source

> **source**: `string`

***

### verify

> **verify**: (`req`) => `boolean` \| `Promise`\<`boolean`\>

#### Parameters

##### req

`Request`

#### Returns

`boolean` \| `Promise`\<`boolean`\>
