> **validateSyncMutationBatch**(`mutations`): [`SyncBatchValidationOutcome`](../type-aliases/SyncBatchValidationOutcome.md)

Up-front validation shared by both batch transports (HTTP and socket): reject an
oversized batch or one with intra-batch duplicate mutationIds before anything is
applied. On failure, returns a single-element `results` array carrying a
`validation` nack for the offending mutation (or an empty-batch guard) — mirroring
the shape callers expect from `applySyncMutationBatch`, but produced without
touching the idempotency ledger since nothing was attempted.

## Parameters

### mutations

[`SyncMutateRequest`](../interfaces/SyncMutateRequest.md)[]

## Returns

[`SyncBatchValidationOutcome`](../type-aliases/SyncBatchValidationOutcome.md)
