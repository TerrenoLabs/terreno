Payload sent by the client to subscribe to a query-filtered list.

## Properties

### collection

> **collection**: `string`

Collection tag (e.g. "todos")

***

### query

> **query**: `Record`\<`string`, `unknown`\>

MongoDB-style query filter (e.g. {completed: false})

***

### queryId?

> `optional` **queryId?**: `string`

Client-provided queryId (ignored — server computes a canonical ID)
