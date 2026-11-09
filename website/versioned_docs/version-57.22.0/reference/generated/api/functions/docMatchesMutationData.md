> **docMatchesMutationData**(`doc`, `data`): `boolean`

C5 (FIX 6): true when every key/value in `data` (the mutation's own
intended write) is already present on `doc` — used alongside the
expected-post-write-seq check to distinguish "this mutation's own write
already landed" (safe to report as already-applied) from "a genuinely
different write landed and happens to have advanced the seq by exactly
one" (a real conflict; a seq match alone cannot tell these apart).

## Parameters

### doc

`unknown`

### data

`Record`\<`string`, `unknown`\> \| `undefined`

## Returns

`boolean`
