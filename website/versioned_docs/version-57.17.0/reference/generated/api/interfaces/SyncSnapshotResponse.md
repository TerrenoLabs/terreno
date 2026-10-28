Response shape for `GET /sync/snapshot` (C2: one stream per request).

## Properties

### cursor

> **cursor**: `number`

Highest seq included in this page (C1: never above `frontierSeq`); pass back as
`cursor` to continue.

***

### entities

> **entities**: [`SyncEntityPayload`](SyncEntityPayload.md)[]

***

### frontierSeq

> **frontierSeq**: `number`

C1: the stream's stable frontier — the client must not advance its cursor beyond this.

***

### hasMore

> **hasMore**: `boolean`

True when more pages remain past `cursor` (more committed OR uncommitted seqs).

***

### legacyCursor?

> `optional` **legacyCursor?**: `string`

C3: opaque forward token for paging the legacy (seq-0) stratum by `_id`. Present
while unstamped legacy documents remain; absent once the stratum is exhausted and
paging proceeds by seq. The client echoes it back verbatim.

***

### oldestRetainedSeq

> **oldestRetainedSeq**: `number`

C7: the lowest seq still retained for this stream after tombstone compaction. A
client whose stored cursor is below this may have missed compacted tombstones and
must re-bootstrap the stream from 0 (sanctioned wipe: retention gap, not auth).

***

### stream

> **stream**: `string`

The stream this page belongs to (echoed from the request).
