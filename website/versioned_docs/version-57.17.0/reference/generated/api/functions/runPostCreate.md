> **runPostCreate**\<`T`\>(`__namedParameters`): `Promise`\<`void`\>

C5 (FIX 6): run `postCreate` outside the write transaction/ledger-finalize
window. Errors are the caller's responsibility to catch — the sync mutation
handler logs them and reports a warning, never converting them into a nack
(the document write already committed and the ledger already finalized
`applied`).

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### doc

[`ExecutorDoc`](../type-aliases/ExecutorDoc.md)\<`T`\>

#### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

#### request

`Request`

## Returns

`Promise`\<`void`\>
