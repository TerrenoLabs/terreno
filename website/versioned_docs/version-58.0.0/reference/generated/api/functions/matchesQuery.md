> **matchesQuery**(`doc`, `query`): `boolean`

Check if a document matches a MongoDB-style query in memory.

Fails closed: malformed clauses, and operands that cannot be compared (for example an
object whose `toString` is not a function), count as a non-match instead of throwing.

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
