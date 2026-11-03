## Properties

### \_id

> **\_id**: `ObjectId`

***

### compactedThroughSeq

> **compactedThroughSeq**: `number`

C7 retention watermark: the highest seq on this stream whose row (tombstone or
scope-move marker) has been hard-deleted by `compactTombstones`. A client whose
cursor is below this may have missed a compacted deletion and must re-bootstrap;
a client at or above it has already seen everything that was reaped. 0 until the
first compaction pass touches the stream.

***

### pending

> **pending**: [`SyncPendingClaim`](SyncPendingClaim.md)[]

C1: seqs claimed but not yet confirmed committed. The stable frontier is
`min(pending.seq) - 1`, or `seq` (the head) when empty, so a cursor never
advances past a seq whose owning write has not yet landed.

***

### seq

> **seq**: `number`

***

### stream

> **stream**: `string`
