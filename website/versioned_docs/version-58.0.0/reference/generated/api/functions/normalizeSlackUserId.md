> **normalizeSlackUserId**(`value`): `string` \| `undefined`

Normalize a Slack member ID. Accepts a bare id (`U012ABCDEF`) or a mention
token (`<@U012ABCDEF>`). Returns undefined when the value is not a Slack
member ID — names and emails cannot be used for mentions.

## Parameters

### value

`string`

## Returns

`string` \| `undefined`
