## Properties

### addLog?

> `optional` **addLog?**: (`level`, `message`) => `Promise`\<`void`\>

#### Parameters

##### level

`"error"` \| `"info"` \| `"warn"`

##### message

`string`

#### Returns

`Promise`\<`void`\>

***

### checkCancellation?

> `optional` **checkCancellation?**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### connection

> **connection**: `Connection`

***

### dryRun

> **dryRun**: `boolean`

***

### lockPollMs?

> `optional` **lockPollMs?**: `number`

***

### lockTtlMs?

> `optional` **lockTtlMs?**: `number`

***

### logger?

> `optional` **logger?**: [`MigrationLogger`](MigrationLogger.md)

***

### migrations

> **migrations**: [`LoadedMigration`](LoadedMigration.md)[]

***

### mongoose

> **mongoose**: `__module`
