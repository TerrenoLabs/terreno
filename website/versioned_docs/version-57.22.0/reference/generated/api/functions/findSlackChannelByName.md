> **findSlackChannelByName**(`__namedParameters`): `Promise`\<[`SlackChannelRef`](../interfaces/SlackChannelRef.md) \| `undefined`\>

Find a public channel, or a private channel the bot is already in.
Returns undefined when the name is not visible to the bot. Archived
channels are skipped. Requires `channels:read` and `groups:read`.

## Parameters

### \_\_namedParameters

[`FindSlackChannelOptions`](../interfaces/FindSlackChannelOptions.md)

## Returns

`Promise`\<[`SlackChannelRef`](../interfaces/SlackChannelRef.md) \| `undefined`\>
