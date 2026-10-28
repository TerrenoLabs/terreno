> `const` **SyncMutation**: `Model`\<[`SyncMutationDocument`](../interfaces/SyncMutationDocument.md)\>

Idempotency ledger for the sync mutation channel. A row is inserted with status
`pending` before a mutation is applied (the atomic claim on the unique mutationId);
the outcome is recorded on the same row so duplicate deliveries — socket retries or
the HTTP fallback racing a socket send — read back the recorded outcome instead of
re-applying.

Task 9.21: a row NEVER stores document data. A conflict records only
`{resultId, resultSeq}`; a duplicate delivery re-serializes the live document from
`resultId` through the collection's sync `responseHandler`, so PHI is not retained in
`syncmutations` for the 30-day TTL and the client also sees current (not stale) state.
