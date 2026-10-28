> **extractUserFromHeaders**(`headers`, `context`): `Promise`\<[`User`](../interfaces/User.md) \| `undefined`\>

Extract user from raw headers using whichever auth provider is configured.
Works with both JWT and Better Auth, mirroring authenticateMiddleware behavior.

## Parameters

### headers

`Record`\<`string`, `string` \| `string`[] \| `undefined`\>

### context

[`MCPAuthContext`](../interfaces/MCPAuthContext.md)

## Returns

`Promise`\<[`User`](../interfaces/User.md) \| `undefined`\>
