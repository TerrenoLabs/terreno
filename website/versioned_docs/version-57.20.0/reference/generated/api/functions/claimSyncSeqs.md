> **claimSyncSeqs**(`__namedParameters`): `Promise`\<[`SyncSeqClaim`](../interfaces/SyncSeqClaim.md)\>

C1: atomically claim `count` sequence numbers for a stream AND register them on
the in-flight registry so the stable frontier can exclude them until committed.

Two modes:
- **No caller session (the hot path):** one `findOneAndUpdate` does `$inc: {seq}`
  plus `$push` of a `pending` entry per claimed seq. The write commits separately,
  so `confirmSyncSeqs` must `$pull` the entries once it lands. Until then the
  frontier holds below the lowest pending seq.
- **Caller session present:** the `$inc` and the document write commit atomically
  in the caller's transaction, so there is no window where a claimed seq is
  uncommitted — the pending registry is skipped (`registered: false`, nothing to
  confirm). Frontier logic treats a session-backed claim as already committed.

Retries once on the upsert race (two concurrent first claims for a new stream).

## Parameters

### \_\_namedParameters

#### count?

`number` = `1`

#### session?

`ClientSession` \| `null`

#### stream

`string`

## Returns

`Promise`\<[`SyncSeqClaim`](../interfaces/SyncSeqClaim.md)\>
