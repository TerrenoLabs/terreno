## Properties

### clearConflicts

> **clearConflicts**: () => `void`

Clear all conflict records

#### Returns

`void`

***

### conflicts

> **conflicts**: [`ConflictRecord`](ConflictRecord.md)[]

All conflict records (including dismissed)

***

### dismissConflict

> **dismissConflict**: (`id`) => `void`

Dismiss a single conflict notification by ID

#### Parameters

##### id

`string`

#### Returns

`void`

***

### isLocalOnly

> **isLocalOnly**: (`id`) => `boolean`

Returns true if the item exists only locally (not yet synced to server)

#### Parameters

##### id

`string`

#### Returns

`boolean`

***

### isOnline

> **isOnline**: `boolean`

Whether the device currently has network connectivity

***

### isSyncing

> **isSyncing**: `boolean`

Whether mutations are currently being replayed to the server

***

### queueLength

> **queueLength**: `number`

Number of mutations waiting to be synced

***

### undismissedConflicts

> **undismissedConflicts**: [`ConflictRecord`](ConflictRecord.md)[]

Conflict records the user hasn't dismissed yet
