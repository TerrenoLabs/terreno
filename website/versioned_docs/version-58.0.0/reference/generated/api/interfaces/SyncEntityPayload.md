A single entity in a snapshot response.

## Properties

### data

> **data**: `unknown`

Serialized document data (present for tombstones too, so clients can render conflicts).

***

### deleted

> **deleted**: `boolean`

True when the entity is a soft-delete tombstone.

***

### id

> **id**: `string`

Document id.

***

### seq

> **seq**: `number`

The document's `_syncSeq` — the client's per-entity version and cursor source.
