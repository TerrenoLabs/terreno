Fields added to synced documents by `syncPlugin`.

## Properties

### \_syncPrevStream?

> `optional` **\_syncPrevStream?**: `string` \| `null`

The document's previous stream key, set when a write moved the document between
scopes (owner/tenant change); null when the last write did not move it.

***

### \_syncSeq?

> `optional` **\_syncSeq?**: `number`

Monotonic per-stream sequence stamped on every synced write.
