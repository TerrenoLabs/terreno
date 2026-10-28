## Extends

- `Document`.[`BackgroundTaskMethods`](BackgroundTaskMethods.md)

## Properties

### addLog

> **addLog**: (`this`, `level`, `message`) => `Promise`\<`void`\>

#### Parameters

##### this

`BackgroundTaskDocument`

##### level

`"error"` \| `"info"` \| `"warn"`

##### message

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`BackgroundTaskMethods`](BackgroundTaskMethods.md).[`addLog`](BackgroundTaskMethods.md#addlog)

***

### completedAt?

> `optional` **completedAt?**: `Date`

***

### created

> **created**: `Date`

***

### createdBy?

> `optional` **createdBy?**: `ObjectId`

***

### deleted

> **deleted**: `boolean`

***

### error?

> `optional` **error?**: `string`

***

### isDryRun

> **isDryRun**: `boolean`

***

### logs

> **logs**: `BackgroundTaskLog`[]

***

### progress?

> `optional` **progress?**: `BackgroundTaskProgress`

***

### result?

> `optional` **result?**: `string`[]

***

### startedAt?

> `optional` **startedAt?**: `Date`

***

### status

> **status**: `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

***

### taskType

> **taskType**: `string`

***

### updated

> **updated**: `Date`

***

### updateProgress

> **updateProgress**: (`this`, `percentage`, `stage?`, `message?`) => `Promise`\<`void`\>

#### Parameters

##### this

`BackgroundTaskDocument`

##### percentage

`number`

##### stage?

`string`

##### message?

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`BackgroundTaskMethods`](BackgroundTaskMethods.md).[`updateProgress`](BackgroundTaskMethods.md#updateprogress)
