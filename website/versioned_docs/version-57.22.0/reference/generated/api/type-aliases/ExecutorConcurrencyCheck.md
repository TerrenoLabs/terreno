> **ExecutorConcurrencyCheck** = \{ `ifUnmodifiedSince`: `Date`; `invalidTimestampDetail?`: `string`; `type`: `"timestamp"`; \} \| \{ `baseSeq`: `number`; `type`: `"seq"`; \}

Optimistic-concurrency check for executeUpdate.

- `timestamp`: replicates the REST `If-Unmodified-Since` last-write-wins check. The update
  is rejected with an `ExecutorConflictError` (409) when `ifUnmodifiedSince` is older than
  the document's `updated` (falling back to `created`) timestamp. An invalid Date throws a
  400 "Invalid conflict-detection timestamp" carrying `invalidTimestampDetail` so REST
  handlers can report which header/body field failed to parse.
- `seq`: compares `baseSeq` against the document's `_syncSeq`; any mismatch throws an
  `ExecutorConflictError` (409) carrying the current server doc and seq.

The check runs after `preUpdate` (same as the REST handler) so unauthorized mutations are
rejected before document data can leak in a conflict response.

## Union Members

### Type Literal

\{ `ifUnmodifiedSince`: `Date`; `invalidTimestampDetail?`: `string`; `type`: `"timestamp"`; \}

#### ifUnmodifiedSince

> **ifUnmodifiedSince**: `Date`

Reject the update if the doc was modified after this instant.

#### invalidTimestampDetail?

> `optional` **invalidTimestampDetail?**: `string`

Detail for the 400 error when `ifUnmodifiedSince` is an invalid Date.

#### type

> **type**: `"timestamp"`

***

### Type Literal

\{ `baseSeq`: `number`; `type`: `"seq"`; \}

#### baseSeq

> **baseSeq**: `number`

The `_syncSeq` the client last saw; must match the doc's current `_syncSeq`.

#### type

> **type**: `"seq"`
