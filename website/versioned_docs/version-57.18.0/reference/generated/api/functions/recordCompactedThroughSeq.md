> **recordCompactedThroughSeq**(`__namedParameters`): `Promise`\<`void`\>

C7: raise a stream's retention watermark to `seq` (never lowers it — `$max`), called by
`compactTombstones` after it hard-deletes rows. Served to clients as the snapshot's
`oldestRetainedSeq`, which is the only signal that a stale cursor must re-bootstrap.
Does not create the counter: a stream with compacted rows always already has one.

## Parameters

### \_\_namedParameters

#### seq

`number`

#### stream

`string`

## Returns

`Promise`\<`void`\>
