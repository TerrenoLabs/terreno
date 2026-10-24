## Properties

### apiPath?

> `optional` **apiPath?**: `string`

Override the chat API endpoint path. Defaults to "/api/chat".

***

### baseURL?

> `optional` **baseURL?**: `string`

Base URL of the Terreno backend. Defaults to the resolved baseUrl from constants.

***

### id?

> `optional` **id?**: `string`

Chat ID for session management.

***

### onError?

> `optional` **onError?**: (`error`) => `void`

Callback when an error occurs.

#### Parameters

##### error

`Error`

#### Returns

`void`

***

### tokenSource?

> `optional` **tokenSource?**: `AuthProvider`

Token source for the chat requests' `Authorization: Bearer` header. Defaults to the source
registered with `setTokenSource`, else the built-in JWT source. The hook reads `getToken()`
on every request and sends no `Authorization` header when it returns no token.
