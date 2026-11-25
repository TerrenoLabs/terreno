> **applySyncMutationBatch**(`__namedParameters`): `Promise`\<[`SyncMutateBatchResponse`](../interfaces/SyncMutateBatchResponse.md)\>

Apply a batch of mutations strictly serially, in array order, reusing
`applySyncMutation` per item — full reuse of the idempotency ledger, executors,
permissions, and delta emission. Stops immediately at the first non-ack outcome
(the user's hard requirement, INV-1): mutations after it are neither attempted nor
ledgered, and are safe for the client to resend later (INV-3).

Callers MUST run [validateSyncMutationBatch](validateSyncMutationBatch.md) first (oversized/duplicate
rejection happens before any mutation is attempted); this function assumes the
batch already passed that check.

## Parameters

### \_\_namedParameters

#### mutations

[`SyncMutateRequest`](../interfaces/SyncMutateRequest.md)[]

#### req?

`Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

The real Express request when called over HTTP; hooks receive a `{user}` stub otherwise.

#### scopeResolver?

[`SyncMutationScopeResolver`](../type-aliases/SyncMutationScopeResolver.md)

#### syncOptions?

[`SyncAppOptions`](../interfaces/SyncAppOptions.md)

#### user

[`User`](../interfaces/User.md)

## Returns

`Promise`\<[`SyncMutateBatchResponse`](../interfaces/SyncMutateBatchResponse.md)\>
