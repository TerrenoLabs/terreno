> **assertWritableStream**(`__namedParameters`): `void`

Write-path guard: refuse to file a tenant-scoped document under `tenant:undefined`, a
stream no client can ever subscribe to, which would leave the document written,
invisible, and never synced (Task 9.21).

Called from the `_syncSeq` plugin's write hooks, so it sees the EFFECTIVE scope value —
after any `preCreate` has injected it and before the write commits — on every write
path, sync mutations and plain REST/model writes alike. That is why the sync mutation
handler does not try to infer the same thing from the raw request body: a create may
legitimately omit the field for `preCreate` to supply.

Owner scopes are intentionally not guarded: `ownerId` is conventionally stamped by
`preCreate`/`IsOwner` plumbing, and an unowned document is still admin-reachable, so
tightening that is a separate behavioral change.

## Parameters

### \_\_namedParameters

#### collectionTag

`string`

#### doc

`Record`\<`string`, `unknown`\>

#### scope

[`SyncScope`](../type-aliases/SyncScope.md)

## Returns

`void`
