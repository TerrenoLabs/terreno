Options for the query parameter validator middleware.

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Override the global validateRequests setting for this specific route.

***

### onError?

> `optional` **onError?**: (`errors`, `req`) => `void`

Custom error handler for this specific route.

#### Parameters

##### errors

`ErrorObject`\<`string`, `Record`\<`string`, `any`\>, `unknown`\>[]

##### req

`Request`

#### Returns

`void`
