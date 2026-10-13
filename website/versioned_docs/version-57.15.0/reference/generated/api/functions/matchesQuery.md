> **matchesQuery**(`doc`, `query`): `boolean`

Check if a document matches a MongoDB-style query in memory.

## Parameters

### doc

`Record`\<`string`, `unknown`\>

The document to test (plain object or Mongoose document)

### query

`Record`\<`string`, `unknown`\>

MongoDB-style query object

## Returns

`boolean`

true if the document matches all query conditions
