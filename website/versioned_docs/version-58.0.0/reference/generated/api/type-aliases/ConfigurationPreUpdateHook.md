> **ConfigurationPreUpdateHook** = (`body`, `req`) => `Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\>\>

Hook invoked before a configuration update is applied. Receives the incoming
(already system-field- and secret-field-stripped) body and the request, and
returns the body to apply. Use it to validate or normalize input. Throw an
[APIError](../classes/APIError.md) to reject the update.

## Parameters

### body

`Record`\<`string`, `unknown`\>

### req

`express.Request`

## Returns

`Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\>\>
