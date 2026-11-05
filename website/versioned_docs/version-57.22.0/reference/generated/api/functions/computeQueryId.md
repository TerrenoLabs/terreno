> **computeQueryId**(`collection`, `query`): `string`

Compute a deterministic queryId from collection and query on the server side.
This prevents clients from hijacking other subscriptions by providing a colliding queryId.

## Parameters

### collection

`string`

### query

`Record`\<`string`, `unknown`\>

## Returns

`string`
