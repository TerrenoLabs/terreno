> **assertCanWriteUserIdentity**(`__namedParameters`): `Promise`\<`void`\>

Requires `user:updateIdentity` for generic writes that change another user's
[USER\_IDENTITY\_FIELDS](../variables/USER_IDENTITY_FIELDS.md) on the RBAC user model, so `user:update` alone cannot redirect a
user's email, rebind their external login, or disable them. Keys whose value matches the
target's current value do not count, so clients that echo the whole record still work. The
write is rejected with 403, not stripped. Exempt, like [assertCanWriteTargetUser](assertCanWriteTargetUser.md):
self-writes, writes without an actor (internal server calls), and legacy `admin: true` actors.
Creates are not checked; this guards existing users only.

## Parameters

### \_\_namedParameters

#### accessControl

`unknown`

#### actor?

[`User`](../interfaces/User.md)

#### body

`unknown`

#### modelName

`string`

#### target

`unknown`

## Returns

`Promise`\<`void`\>
