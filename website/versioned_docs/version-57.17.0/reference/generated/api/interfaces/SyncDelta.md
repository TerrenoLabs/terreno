A change event delivered to subscribed clients via `sync:delta`.

## Per-entity ordering & the LWW-by-seq contract (C8)

The server serializes delta dispatch PER entity (`{collection}:{id}`): two deltas for
the same document are always emitted in change-stream (commit) order, so their `seq`
values arrive monotonically for that entity. Deltas for DIFFERENT entities may arrive
in any order (they dispatch concurrently). Clients therefore apply last-writer-wins
BY SEQ within an entity: a delta whose `seq` is at or below the entity's applied seq is
an idempotent no-op; only a strictly higher `seq` mutates local state. Combined with
the C1 frontier (`frontierSeq`), a cursor never advances past an uncommitted seq, so no
committed delta is ever permanently skipped.

## Properties

### collection

> **collection**: `string`

Collection tag (e.g. "todos").

***

### data?

> `optional` **data?**: `unknown`

Serialized document data (omitted for tombstone deltas emitted to a previous stream).

***

### deleted?

> `optional` **deleted?**: `boolean`

True when the entity is soft-deleted.

***

### frontierSeq?

> `optional` **frontierSeq?**: `number`

C1: the stream's stable frontier at emit time. The client advances its cursor to
`min(seq, frontierSeq)` so a delta observed out of commit order never advances a
cursor past an uncommitted hole.

***

### id

> **id**: `string`

Document id.

***

### method

> **method**: [`SyncMutationOperation`](../type-aliases/SyncMutationOperation.md)

***

### seq

> **seq**: `number`

The document's `_syncSeq`.

***

### stream

> **stream**: `string`

Stream key this delta belongs to (e.g. "todos|owner:123").
