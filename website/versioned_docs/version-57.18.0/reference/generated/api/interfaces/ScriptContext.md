## Properties

### addLog

> **addLog**: (`level`, `message`) => `Promise`\<`void`\>

Add a log entry to the task.

#### Parameters

##### level

`"error"` \| `"info"` \| `"warn"`

##### message

`string`

#### Returns

`Promise`\<`void`\>

***

### args

> **args**: [`ScriptArgs`](ScriptArgs.md)

Arguments supplied to this run (from the CLI, HTTP body, or admin UI).

***

### checkCancellation

> **checkCancellation**: () => `Promise`\<`void`\>

Check if the task has been cancelled. Throws TaskCancelledError if so.

#### Returns

`Promise`\<`void`\>

***

### updateProgress

> **updateProgress**: (`percentage`, `stage?`, `message?`) => `Promise`\<`void`\>

Update progress on the task.

#### Parameters

##### percentage

`number`

##### stage?

`string`

##### message?

`string`

#### Returns

`Promise`\<`void`\>
