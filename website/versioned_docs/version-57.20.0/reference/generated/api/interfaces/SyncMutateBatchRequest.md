A batch of client mutations delivered via `sync:mutateBatch` or
`POST /sync/mutate/batch`. The server MUST apply strictly in array order and
stop at the first non-ack outcome (see `applySyncMutationBatch`).

## Properties

### batchId?

> `optional` **batchId?**: `string`

Client-generated correlation id, socket transport only (ignored over
HTTP). Echoed back immediately via `sync:batchReceived {batchId}` before
processing begins, so the client can distinguish "the server has no
sync:mutateBatch handler" (silence past the grace period, batching
unsupported) from "the server is just slow to finish this batch" (a
receipt arrived; keep waiting up to the full batch timeout).

***

### mutations

> **mutations**: [`SyncMutateRequest`](SyncMutateRequest.md)[]

Ordered mutations; each still carries its own mutationId.
