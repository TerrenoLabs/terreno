> **serializeSyncDoc**(`__namedParameters`): `Promise`\<`unknown`\>

Serialize a document for a sync payload through the fallback chain:
sync responseHandler > modelRouter responseHandler > toJSON.
Delegates to the shared `serializeSyncPayload` (also used for `sync:delta` emission).

## Parameters

### \_\_namedParameters

#### doc

`Document`

#### entry

[`SyncRegistryEntry`](../interfaces/SyncRegistryEntry.md)

#### req

`Request`

## Returns

`Promise`\<`unknown`\>
