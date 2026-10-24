Successful mutation acknowledgement.

## Properties

### id

> **id**: `string`

The document id (server-assigned for creates).

***

### mutationId

> **mutationId**: `string`

***

### seq

> **seq**: `number`

The document's new `_syncSeq`.

***

### warning?

> `optional` **warning?**: `string`

C5 (FIX 6): set when the document write succeeded and the ledger
finalized `applied`, but the model's post-hook (`postCreate`/
`postUpdate`/`postDelete`) threw. The mutation is still a full success —
this is informational only, never a reason to retry or roll back.
