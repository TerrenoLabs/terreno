---
category: Added
---

- `@terreno/syncdb` `createSyncDb({idFormats})` mints 24-hex ObjectIds for a collection set to `"objectId"`, so a model that keeps Mongoose's default ObjectId `_id` can sync without migrating its ids. `mutate()` throws on an explicit non-hex id for such a collection. `generateObjectId` and the `SyncIdFormat` type are exported.
- Sync `validation` nacks carry an optional `reason`: `invalid_id` when an ObjectId-keyed collection gets a non-hex id (rejected before the mutation is claimed), and `id_collision` when a create names an `_id` another document holds. A collision never touches the existing document and its message never names the holder. The ledger records the reason (`SyncMutation.nackReason`) so a redelivery replays it.
- `GET /sync/entities` leaves out non-hex ids for an ObjectId-keyed model instead of answering 400, so a rejected create queued for repair cannot fail the rest of the repair batch.
