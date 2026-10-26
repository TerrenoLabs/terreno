> **assertCanWriteTargetUser**(`__namedParameters`): `Promise`\<`void`\>

Enforces RoleManager's target-privilege rule on generic writes to the RBAC user model: an actor
may change or delete another user only when the actor holds every permission that user holds.
REST, array subroutes, write instance actions, sync, and MCP all call this, so a `user:update`
holder cannot take over or lock out a more privileged account. Self-writes and legacy
`admin: true` actors (the plane above RBAC) are not checked, and neither are writes without an
authenticated actor (internal server calls).

## Parameters

### \_\_namedParameters

#### accessControl

`unknown`

#### actor?

[`User`](../interfaces/User.md)

#### modelName

`string`

#### target

`unknown`

## Returns

`Promise`\<`void`\>
