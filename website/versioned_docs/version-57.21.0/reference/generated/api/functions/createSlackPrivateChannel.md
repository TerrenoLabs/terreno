> **createSlackPrivateChannel**(`__namedParameters`): `Promise`\<[`SlackPrivateChannelResult`](../interfaces/SlackPrivateChannelResult.md)\>

Create a private channel in the workspace for `SLACK_BOT_TOKEN`, invite
members, and optionally post the first message.

Requires bot scopes `groups:write`, `groups:write.invites`, and `chat:write`.
`name_taken` throws a 409. Call `findSlackChannelByName` to reuse a channel
the bot can already see.

## Parameters

### \_\_namedParameters

[`CreateSlackPrivateChannelOptions`](../interfaces/CreateSlackPrivateChannelOptions.md)

## Returns

`Promise`\<[`SlackPrivateChannelResult`](../interfaces/SlackPrivateChannelResult.md)\>
