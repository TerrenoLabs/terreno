## Properties

### conflicts

> **conflicts**: [`ConflictRecord`](ConflictRecord.md)[]

***

### isOnline

> **isOnline**: `boolean`

***

### isSyncing

> **isSyncing**: `boolean`

***

### lastUserId?

> `optional` **lastUserId?**: `string`

Last user id confirmed by a non-JWT token source's `getUserId()`. Persisted with the slice so
mutations made after an offline launch are tagged with it; cleared on logout and sign-out.
Unused on the JWT path, which reads `state.auth.userId`.

***

### queue

> **queue**: [`QueuedMutation`](QueuedMutation.md)[]
