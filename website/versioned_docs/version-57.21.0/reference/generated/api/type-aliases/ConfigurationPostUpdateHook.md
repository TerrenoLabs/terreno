> **ConfigurationPostUpdateHook** = (`config`, `prevValue`, `req`) => `void` \| `Promise`\<`void`\>

Hook invoked after a configuration update is applied. Receives the updated
configuration and the previous value (both with secret values redacted) plus
the request, enabling audit logging of who changed what. Secret values are
never included.

## Parameters

### config

`Record`\<`string`, `unknown`\>

### prevValue

`Record`\<`string`, `unknown`\>

### req

`express.Request`

## Returns

`void` \| `Promise`\<`void`\>
