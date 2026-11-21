> **resolveStreamForDoc**(`__namedParameters`): `string`

Resolve the stream a document belongs to under the given scope.

Deliberately total: readers (the change-stream watcher, the tombstone compactor) must
be able to name a stream for any document already in the database, including legacy
rows written before a scope field existed. Rejecting an unroutable document is the
write path's job — see [assertWritableStream](assertWritableStream.md).

## Parameters

### \_\_namedParameters

#### collectionTag

`string`

#### doc

`Record`\<`string`, `unknown`\>

#### scope

[`SyncScope`](../type-aliases/SyncScope.md)

## Returns

`string`
