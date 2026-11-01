> **runSyncBatch**(`__namedParameters`): `Promise`\<[`SyncBatchRunResult`](../interfaces/SyncBatchRunResult.md)\>

Shared orchestration for a BATCH: validate (size cap + intra-batch duplicate ids),
then rate limit, then apply.

Validation runs FIRST so a malformed batch consumes no budget — it was never going to
be applied, and charging for it let a buggy client rate-limit itself out of the
mutations that would have succeeded. The budget is then charged per MUTATION (not per
batch), so batching cannot buy extra throughput over single sends.

## Parameters

### \_\_namedParameters

#### mutations

[`SyncMutateRequest`](../interfaces/SyncMutateRequest.md)[]

#### req?

`Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

#### scopeResolver?

[`SyncMutationScopeResolver`](../type-aliases/SyncMutationScopeResolver.md)

#### syncOptions?

[`SyncAppOptions`](../interfaces/SyncAppOptions.md)

#### user

[`User`](../interfaces/User.md)

## Returns

`Promise`\<[`SyncBatchRunResult`](../interfaces/SyncBatchRunResult.md)\>
