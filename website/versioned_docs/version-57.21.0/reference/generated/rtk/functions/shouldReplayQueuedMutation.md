> **shouldReplayQueuedMutation**(`mutation`, `currentUserId`): `boolean`

Whether a queued mutation may be replayed for the currently signed-in user.
Legacy entries without userId are discarded to avoid cross-account replay after account switch.

## Parameters

### mutation

[`QueuedMutation`](../interfaces/QueuedMutation.md)

### currentUserId

`string` \| `undefined`

## Returns

`boolean`
