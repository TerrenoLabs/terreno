Result of a seq claim: the last seq claimed (range [lastSeq - count + 1, lastSeq])
and whether the claim registered a pending entry that a later `confirmSyncSeqs`
must clear. A session-backed claim skips the pending registry entirely (the write
and the `$inc` commit atomically), so `registered` is false and no confirm is due.

## Properties

### lastSeq

> **lastSeq**: `number`

The last (highest) seq claimed; the range is [lastSeq - count + 1, lastSeq].

***

### registered

> **registered**: `boolean`

True when a pending registry entry was recorded and `confirmSyncSeqs` must clear it.

***

### seqs

> **seqs**: `number`[]

Every seq claimed, in ascending order (the range materialized).
