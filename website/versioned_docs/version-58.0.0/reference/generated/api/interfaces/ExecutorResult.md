Result of a successful executor run.

## Type Parameters

### T

`T`

## Properties

### cleanedBody?

> `optional` **cleanedBody?**: `Partial`\<`T`\>

C5 (FIX 6): present only when `executeUpdate` was called with
`skipPostHooks: true` — the cleaned/transformed update body, needed to
run `postUpdate` later via `runPostUpdate`.

***

### doc

> **doc**: [`ExecutorDoc`](../type-aliases/ExecutorDoc.md)\<`T`\>

The document after the operation completed: the created doc, the saved update, or the
deleted doc (tombstoned with `deleted: true` for soft-delete models). Populated per
`options.populatePaths` for create/update, matching the REST handlers.

***

### prevDoc?

> `optional` **prevDoc?**: `T`

C5 (FIX 6): present only when `executeUpdate` was called with
`skipPostHooks: true` — the pre-update document snapshot, needed to
run `postUpdate` later via `runPostUpdate`.
