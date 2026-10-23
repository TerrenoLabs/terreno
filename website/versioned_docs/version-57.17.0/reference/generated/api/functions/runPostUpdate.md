> **runPostUpdate**\<`T`\>(`__namedParameters`): `Promise`\<`void`\>

C5 (FIX 6): run `postUpdate` outside the write/ledger-finalize window — see `runPostCreate`.

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### cleanedBody

`Partial`\<`T`\>

#### doc

[`ExecutorDoc`](../type-aliases/ExecutorDoc.md)\<`T`\>

#### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

#### prevDoc

`T`

#### request

`Request`

## Returns

`Promise`\<`void`\>
