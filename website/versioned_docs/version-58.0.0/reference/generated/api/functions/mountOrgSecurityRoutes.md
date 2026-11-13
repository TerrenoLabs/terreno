> **mountOrgSecurityRoutes**(`__namedParameters`): `void`

Mounts the AccountSecurityApp routes on an OrgsApp router at
`/:orgId/members/:userId/security/*`. Platform-only actions (`disable`, `enable`,
`issue-sign-in-link`) are left out; org-only ones (`suspend-membership`) are added.

## Parameters

### \_\_namedParameters

#### access

[`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

#### accountSecurity

[`AccountSecurityApp`](../classes/AccountSecurityApp.md)

#### orgRecovery?

[`OrgRecoveryOptions`](../interfaces/OrgRecoveryOptions.md)

#### router

`Router`

#### userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

`void`
