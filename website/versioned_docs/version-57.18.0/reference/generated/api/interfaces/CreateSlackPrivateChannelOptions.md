## Properties

### initialMessage?

> `optional` **initialMessage?**: `string`

***

### mentionUserIds?

> `optional` **mentionUserIds?**: `string`[]

Member IDs to @-mention in `initialMessage`.

***

### name

> **name**: `string`

Slack channel name: lowercase letters, numbers, hyphens, underscores, max 80.

***

### token?

> `optional` **token?**: `string`

Defaults to `SLACK_BOT_TOKEN`. One workspace token for every Terreno app.

***

### userIds?

> `optional` **userIds?**: `string`[]

Slack member IDs to invite. The bot is already a member because it creates the channel.
