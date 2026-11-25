> **inviteSlackUsersToChannel**(`__namedParameters`): `Promise`\<[`SlackInviteResult`](../interfaces/SlackInviteResult.md)\>

Invite staff to a channel the bot already belongs to. Private channels do
not allow a bot to join itself; invite the app once, then call this.

`groups:write.invites` covers private channels. `channels:write.invites`
covers public channels. Member IDs that are already in the channel are
reported on `alreadyMemberUserIds` and do not fail the call.

## Parameters

### \_\_namedParameters

[`InviteSlackUsersOptions`](../interfaces/InviteSlackUsersOptions.md)

## Returns

`Promise`\<[`SlackInviteResult`](../interfaces/SlackInviteResult.md)\>
