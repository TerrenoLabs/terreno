## Properties

### baseUrl

> **baseUrl**: `string`

***

### captureEvent?

> `optional` **captureEvent?**: (`eventName`, `data`) => `void`

#### Parameters

##### eventName

`string`

##### data

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### getAuthToken

> **getAuthToken**: () => `Promise`\<`string` \| `null`\>

#### Returns

`Promise`\<`string` \| `null`\>

***

### onConnect?

> `optional` **onConnect?**: () => `void`

#### Returns

`void`

***

### onConnectError?

> `optional` **onConnectError?**: (`error`) => `void`

#### Parameters

##### error

`Error`

#### Returns

`void`

***

### onDisconnect?

> `optional` **onDisconnect?**: () => `void`

#### Returns

`void`

***

### onReconnectFailed?

> `optional` **onReconnectFailed?**: () => `void`

#### Returns

`void`

***

### shouldConnect

> **shouldConnect**: `boolean`
