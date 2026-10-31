> **serializeSyncPayload**(`__namedParameters`): `Promise`\<`unknown`\>

Shared serializer for sync payloads (snapshot entities, conflict server docs, and
change-stream deltas), applying the fallback chain:

  sync `responseHandler` > modelRouter `responseHandler` > `toJSON()` > raw object.

Lives in its own module so both the HTTP routes/mutation handler and the realtime
change-stream watcher can import it without deepening the routes -> mutationHandler
import cycle. Accepts hydrated Mongoose documents and the raw BSON objects change
streams deliver (which have neither `toObject` nor `toJSON`).

## Parameters

### \_\_namedParameters

#### doc

`Record`\<`string`, `unknown`\>

#### entry

[`SyncRegistryEntry`](../interfaces/SyncRegistryEntry.md)

#### method?

[`SyncMutationOperation`](../type-aliases/SyncMutationOperation.md) = `"update"`

#### req

`Request`

## Returns

`Promise`\<`unknown`\>
