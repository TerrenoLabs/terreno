> **recordSecurityAction**(`__namedParameters`): `Promise`\<`void`\>

Records a security action: one `AuditEvent` (`source: "security"`, `modelName: "User"`,
`recordId` the target, `verb: "updated"`, `after: {...details, securityAction,
organizationId?}`) when
AuditApp is registered, and one event to every [onSecurityAction](onSecurityAction.md) listener.

The audit write follows the recorder's fire-and-forget convention: the returned promise
settles when it is persisted (or failed and logged); HTTP handlers do not await it.

## Parameters

### \_\_namedParameters

[`RecordSecurityActionArgs`](../interfaces/RecordSecurityActionArgs.md)

## Returns

`Promise`\<`void`\>
