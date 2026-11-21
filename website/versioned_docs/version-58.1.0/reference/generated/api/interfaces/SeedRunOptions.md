## Properties

### allowProductionReset?

> `optional` **allowProductionReset?**: `boolean` \| (() => `boolean` \| `Promise`\<`boolean`\>)

***

### connect?

> `optional` **connect?**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### disconnect?

> `optional` **disconnect?**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### dryRun?

> `optional` **dryRun?**: `boolean`

***

### force?

> `optional` **force?**: `boolean`

***

### log?

> `optional` **log?**: [`ScopedLogger`](ScopedLogger.md)

***

### mode?

> `optional` **mode?**: [`SeedMode`](../type-aliases/SeedMode.md)

***

### name

> **name**: `string`

***

### only?

> `optional` **only?**: `string`[]

***

### steps

> **steps**: [`SeedStep`](SeedStep.md)[]
