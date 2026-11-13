A client mutation delivered via `sync:mutate` or `POST /sync/mutate`.

## Properties

### baseVersion?

> `optional` **baseVersion?**: `number`

The `_syncSeq` the client last saw for this document; enables LWW conflict detection.

***

### collection

> **collection**: `string`

Collection tag (e.g. "todos").

***

### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>

Fields to write (create/update).

***

### id?

> `optional` **id?**: `string`

Target document id (required for update/delete; client-generated allowed for create).

***

### mutationId

> **mutationId**: `string`

Client-generated stable id; the idempotency key.

***

### mutationMode?

> `optional` **mutationMode?**: `"adminWindow"`

When `"adminWindow"`, the server applies AdminApp write semantics (RBAC,
writeOwned, readonly/hidden stripping, audit) instead of product sync
permissions. Ignored unless the collection is `adminBroadcast`, the caller
has admin-window access, and AdminApp registered a write scope.

***

### operation

> **operation**: [`SyncMutationOperation`](../type-aliases/SyncMutationOperation.md)
