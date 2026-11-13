> **lookupSlackUserIdByEmail**(`__namedParameters`): `Promise`\<`string` \| `undefined`\>

Resolve a workspace member's Slack user id from their email.

Incoming webhooks cannot look users up. This calls `users.lookupByEmail` and
needs a bot token with the `users:read.email` scope. Store the returned id on
the staff/user record and pass it to `sendToSlack({mentionUserIds})`.

## Parameters

### \_\_namedParameters

[`LookupSlackUserIdByEmailOptions`](../interfaces/LookupSlackUserIdByEmailOptions.md)

## Returns

`Promise`\<`string` \| `undefined`\>
