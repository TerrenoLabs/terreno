The `onSecurityAction` listener [createSecurityNotificationListener](../functions/createSecurityNotificationListener.md) builds.

> **SecurityNotificationListener**(`event`): `Promise`\<`void`\>

The `onSecurityAction` listener [createSecurityNotificationListener](../functions/createSecurityNotificationListener.md) builds.

## Parameters

### event

[`SecurityActionEvent`](SecurityActionEvent.md)

## Returns

`Promise`\<`void`\>

## Properties

### throttleEntryCount

> **throttleEntryCount**: () => `number`

How many throttle keys are held (expired ones are pruned on each send).

#### Returns

`number`
