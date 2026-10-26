> **notificationsBeforeSend**(`__namedParameters`): `Promise`\<[`NotificationsBeforeSendResult`](../interfaces/NotificationsBeforeSendResult.md) \| `undefined`\>

Duck-typed CommsApp `beforeSend` hook that cancels outbound delivery when the user
disabled that channel in NotificationPreference. Missing preference rows default to
all channels on. The `verification` channel is never cancelled here.

## Parameters

### \_\_namedParameters

[`NotificationsBeforeSendContext`](../interfaces/NotificationsBeforeSendContext.md)

## Returns

`Promise`\<[`NotificationsBeforeSendResult`](../interfaces/NotificationsBeforeSendResult.md) \| `undefined`\>
