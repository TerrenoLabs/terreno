> **applySyncMutation**(`__namedParameters`): `Promise`\<[`SyncMutationOutcome`](../type-aliases/SyncMutationOutcome.md)\>

Apply a client mutation through the transport-agnostic executors (permissions,
pre/post hooks, validation) with an atomic idempotency claim. Always finalizes the
claimed ledger row before returning so duplicate deliveries can read the outcome back.

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

`Promise`\<[`SyncMutationOutcome`](../type-aliases/SyncMutationOutcome.md)\>
