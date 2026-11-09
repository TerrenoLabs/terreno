> **runSyncMutation**(`__namedParameters`): `Promise`\<[`SyncMutationRunResult`](../interfaces/SyncMutationRunResult.md)\>

Shared orchestration for a SINGLE mutation: rate limit, then apply.

## Parameters

### \_\_namedParameters

#### mutation

[`SyncMutateRequest`](../interfaces/SyncMutateRequest.md)

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

`Promise`\<[`SyncMutationRunResult`](../interfaces/SyncMutationRunResult.md)\>
