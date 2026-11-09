> **getCompactedThroughSeq**(`__namedParameters`): `Promise`\<`number`\>

C7: the stream's retention watermark — the highest seq whose tombstone/marker has been
compacted away. 0 when nothing has been compacted (no retention gap to enforce).

## Parameters

### \_\_namedParameters

#### stream

`string`

## Returns

`Promise`\<`number`\>
