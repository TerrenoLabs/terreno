> `const` **SyncScopeMove**: `Model`\<[`SyncScopeMoveDocument`](../interfaces/SyncScopeMoveDocument.md)\>

C4: durable marker written in the same op-scope as a scope move, replacing the
racy `_syncPrevStream` post-image read. The old stream tombstones the document
from this marker (change-stream fan-out + snapshot catch-up), so a racing second
write that overwrites `_syncPrevStream` can no longer erase the tombstone.

Retention: reaped only by `compactTombstones`, which honors the owning model's
`retentionDays` and records a `compactedThroughSeq` watermark as it deletes.
