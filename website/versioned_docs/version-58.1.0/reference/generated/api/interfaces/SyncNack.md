Rejected mutation. Conflict nacks carry the canonical server document.

## Properties

### code

> **code**: [`SyncNackCode`](../type-aliases/SyncNackCode.md)

***

### message?

> `optional` **message?**: `string`

***

### mutationId

> **mutationId**: `string`

***

### reason?

> `optional` **reason?**: [`SyncNackReason`](../type-aliases/SyncNackReason.md)

Set on `validation` nacks caused by the entity id (see [SyncNackReason](../type-aliases/SyncNackReason.md)).

***

### retryAfterMs?

> `optional` **retryAfterMs?**: `number`

Minimum time (ms) the client should wait before retrying, filled by the
server with the remaining rate-limit window (`rate_limited` nacks only).

***

### serverDoc?

> `optional` **serverDoc?**: `unknown`

Canonical serialized server document (conflict nacks).

***

### serverSeq?

> `optional` **serverSeq?**: `number`

The server document's current `_syncSeq` (conflict nacks).
