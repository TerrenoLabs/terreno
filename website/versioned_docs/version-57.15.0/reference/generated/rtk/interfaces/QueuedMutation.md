## Properties

### args

> **args**: `unknown`

Original mutation arguments

***

### baseUpdatedAt?

> `optional` **baseUpdatedAt?**: `string`

Document `_updatedAt` at queue time (used for If-Unmodified-Since on replay)

***

### endpointName

> **endpointName**: `string`

RTK Query endpoint name, e.g. "patchTodosById"

***

### id

> **id**: `string`

Unique identifier for this queued mutation

***

### timestamp

> **timestamp**: `string`

ISO timestamp of when the mutation was queued

***

### type

> **type**: `"delete"` \| `"create"` \| `"update"`

The type of CRUD operation

***

### userId?

> `optional` **userId?**: `string`

Auth user ID when the mutation was queued; replay is skipped if it does not match the current user
