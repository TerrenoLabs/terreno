> **releaseSyncSeqs**(`__namedParameters`): `Promise`\<`void`\>

Cancel claimed-but-never-used seqs (Task 9.13): the owning write failed, so the seqs
will never be stamped on any document and holding the frontier below them for the
full lease would stall every catch-up cursor on the stream for no reason. Unlike
`confirmSyncSeqs` this is only safe when the write is known NOT to have committed
(e.g. a Mongoose `VersionError`, where the conditional update matched no document).

## Parameters

### \_\_namedParameters

#### seqs

`number`[]

#### session?

`ClientSession` \| `null`

#### stream

`string`

## Returns

`Promise`\<`void`\>
