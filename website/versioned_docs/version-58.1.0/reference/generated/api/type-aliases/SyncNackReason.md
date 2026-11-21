> **SyncNackReason** = `"id_collision"` \| `"invalid_id"`

Why a `validation` nack rejected a mutation, when the cause is the entity id itself.
`id_collision`: a create named an `_id` that already exists. `invalid_id`: the id is not a
24-character hex ObjectId for an ObjectId-keyed collection.
