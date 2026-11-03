> **addQuerySubscription**(`socketId`, `collection`, `query`, `queryId`): `void`

Register a query subscription for a socket.
The socket joins the `query:{queryId}` room (handled by the caller).

## Parameters

### socketId

`string`

### collection

`string`

### query

`Record`\<`string`, `unknown`\>

### queryId

`string`

## Returns

`void`
