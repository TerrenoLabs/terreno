> **prepareAdminWindowMutation**(`__namedParameters`): `Promise`\<\{ `mutation`: [`SyncMutateRequest`](../interfaces/SyncMutateRequest.md); `scope`: [`AdminWindowMutationScope`](../interfaces/AdminWindowMutationScope.md); \} \| `undefined`\>

Validates an explicit `mutationMode: "adminWindow"` marker and applies AdminApp write
semantics before the product sync executor runs. Returns the mutation with stripped
data, or `undefined` when the request stays on the product path.

The marker alone is never trusted: callers must also have admin-window access, the
collection must be `adminBroadcast`, and AdminApp must have registered a write scope.

## Parameters

### \_\_namedParameters

#### entry

[`SyncRegistryEntry`](../interfaces/SyncRegistryEntry.md)

#### mutation

[`SyncMutateRequest`](../interfaces/SyncMutateRequest.md)

#### req

`Request`

#### syncOptions?

[`SyncAppOptions`](../interfaces/SyncAppOptions.md)

#### user

[`User`](../interfaces/User.md)

## Returns

`Promise`\<\{ `mutation`: [`SyncMutateRequest`](../interfaces/SyncMutateRequest.md); `scope`: [`AdminWindowMutationScope`](../interfaces/AdminWindowMutationScope.md); \} \| `undefined`\>
