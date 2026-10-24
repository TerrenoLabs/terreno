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

***

### userIdConfirmed?

> `optional` **userIdConfirmed?**: `boolean`

`false` when `userId` came from a persisted token-source id that no read in this process had
confirmed yet. A read that returns a user keeps the mutation (and clears this flag) only when
it names the same user and no auth change or source swap happened since; otherwise the
mutation is dropped. Absent means confirmed.
