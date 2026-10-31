> **emitSyncDeltaForChange**(`__namedParameters`): `Promise`\<`void`\>

Emit `sync:delta` events for a change on a sync-registered collection.

Deltas fan out to the dedicated `sync:{stream}` rooms joined via `sync:subscribe`
(independent of the legacy realtime rooms), with the same per-socket read-permission
checks as legacy events. `seq` and `stream` come from the post-image: the `syncPlugin`
stamps `_syncSeq` on every synced write and the watcher runs `updateLookup`.

Soft deletes (an update setting `deleted: true`, reclassified by `mapOperationType`)
produce a `method: "delete"` delta with `deleted: true` and the tombstone data intact.

Scope moves (C4): the old-stream tombstone is derived from durable `SyncScopeMove`
markers (written by `syncPlugin` in the same op-scope as the move), NOT from the racy
`_syncPrevStream` post-image — a second write racing this event's processing can reset
`_syncPrevStream`, but it cannot erase the durable marker. For each marker on this
document, a data-less tombstone is emitted to the marker's `fromStream` (carrying the
marker's old-stream seq), and the new-stream delta is reported as `method: "create"`.
Client tombstone application is idempotent by seq, so re-emitting a marker on a later
change of the same doc is harmless.

Every emitted delta carries `frontierSeq` (the emitting stream's stable frontier at
emit time, C1); the client advances its cursor to `min(delta.seq, delta.frontierSeq)`
so a delta observed out of commit order never advances a cursor past an uncommitted hole.

A model with both `realtime` and `sync` configs emits both the legacy "sync" event and
"sync:delta" — distinct event names, no interference (documented as transitional).

Exported for testing.

## Parameters

### \_\_namedParameters

#### change

`WatchedChange`

#### docId

`string`

#### entry

[`SyncRegistryEntry`](../interfaces/SyncRegistryEntry.md)

#### io

`Server`

#### logDebug

(`msg`) => `void`

## Returns

`Promise`\<`void`\>
