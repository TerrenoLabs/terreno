> **createOrgSecurityAuthorizer**(`__namedParameters`): [`SecurityAuthorizer`](../type-aliases/SecurityAuthorizer.md)

The org authorizer. Order: 401 without a user; 404 for an unknown org; 403 for a disabled org;
403 unless the actor is platform staff or an active org-admin of the org; 404 unless the
target holds an active membership in the org (suspended members are out of reach); then, for
org-admin actors, 403 for platform-role or `admin: true` targets and members younger than
`minMembershipDays`. Platform staff omit `orgScope`, so the shared reach check resolves both
users outside the organization, the same way `/users/:id/security` does.

## Parameters

### \_\_namedParameters

#### access

[`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

#### orgRecovery?

[`OrgRecoveryOptions`](../interfaces/OrgRecoveryOptions.md) = `{}`

#### userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

[`SecurityAuthorizer`](../type-aliases/SecurityAuthorizer.md)
