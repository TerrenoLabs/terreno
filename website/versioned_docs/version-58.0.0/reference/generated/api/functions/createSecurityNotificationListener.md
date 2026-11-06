> **createSecurityNotificationListener**(`__namedParameters`): [`SecurityNotificationListener`](../interfaces/SecurityNotificationListener.md)

Builds the `onSecurityAction` listener that emails the target. Repeats are throttled per
target, template, origin (self or admin), and org, so a burst of one change is one email. It sends nothing for actions
without a template, when `sendMail` is unset, or when the user has no email. A delivery
failure is logged (with the action and user id, never the address) and never fails the action.

## Parameters

### \_\_namedParameters

#### getMailConfig

() => [`SecurityMailConfig`](../interfaces/SecurityMailConfig.md)

#### getUserModel

() => [`UserModel`](../interfaces/UserModel.md)

#### includeOrgName?

`boolean` = `false`

#### now?

() => `number` = `...`

The current time in epoch milliseconds. Tests pass a fake clock.

#### render?

[`SecurityMailRenderer`](../type-aliases/SecurityMailRenderer.md)

#### throttleMinutes?

`number` = `DEFAULT_SECURITY_NOTIFICATION_THROTTLE_MINUTES`

## Returns

[`SecurityNotificationListener`](../interfaces/SecurityNotificationListener.md)
