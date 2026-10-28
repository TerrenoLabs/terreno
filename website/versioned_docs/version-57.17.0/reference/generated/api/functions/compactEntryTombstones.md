> **compactEntryTombstones**(`entry`): `Promise`\<\{ `markers`: `number`; `tombstones`: `number`; \}\>

Compact tombstones and scope-move markers for one registry entry: hard-delete
soft-deleted documents whose `updated` (falling back to `created`) predates the
retention window, plus scope-move markers older than the window.

Task 9.15: the rows are READ before they are deleted so the highest reaped seq per
stream can be recorded as that stream's `compactedThroughSeq` watermark. That watermark
is the snapshot's `oldestRetainedSeq`, and it is the only signal a client has that its
cursor sits below a deletion it can no longer be told about. Deleting without raising it
silently strands the client on stale data. This is also why `SyncScopeMove` no longer
carries a TTL index: an expiry that fires outside this function reaps rows with no
watermark update and ignores the model's `retentionDays`.

## Parameters

### entry

[`SyncRegistryEntry`](../interfaces/SyncRegistryEntry.md)

## Returns

`Promise`\<\{ `markers`: `number`; `tombstones`: `number`; \}\>
