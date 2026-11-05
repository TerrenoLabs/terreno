> **confirmSyncSeqs**(`__namedParameters`): `Promise`\<[`SyncSeqConfirmResult`](../interfaces/SyncSeqConfirmResult.md)\>

C1: confirm that the writes owning `seqs` on `stream` have committed, clearing
their pending registry entries so the stable frontier can advance past them.
A no-op when `seqs` is empty (a session-backed claim registered nothing). Runs
after the document write commits (`post("save")` / query-write post hook); a
`$pull` failure is logged by the caller and left to age out via the lease.

Returns whether anything was actually cleared so callers can detect a reaped
lease — see [SyncSeqConfirmResult](../interfaces/SyncSeqConfirmResult.md).

## Parameters

### \_\_namedParameters

#### seqs

`number`[]

#### session?

`ClientSession` \| `null`

#### stream

`string`

## Returns

`Promise`\<[`SyncSeqConfirmResult`](../interfaces/SyncSeqConfirmResult.md)\>
