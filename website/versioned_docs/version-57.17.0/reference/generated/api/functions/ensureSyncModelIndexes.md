> **ensureSyncModelIndexes**(): `Promise`\<`void`\>

Build the indexes for every sync bookkeeping model, throwing on the first failure so
server startup fails loudly. Kicked off by `SyncApp.register` and awaited through
`ensureSyncIndexes()`; idempotent, so calling it repeatedly is safe.

## Returns

`Promise`\<`void`\>
