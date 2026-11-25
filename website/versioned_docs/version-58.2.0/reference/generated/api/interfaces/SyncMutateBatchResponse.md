Response to a batch mutation request.

`results.length < request.mutations.length` means the server halted at the
first non-ack: `results[results.length - 1]` is that failing outcome, and
every mutation after it was NOT attempted (not ledgered, not applied) —
still safe to resend in a later batch (INV-3).

## Properties

### results

> **results**: [`SyncMutateBatchResult`](../type-aliases/SyncMutateBatchResult.md)[]
