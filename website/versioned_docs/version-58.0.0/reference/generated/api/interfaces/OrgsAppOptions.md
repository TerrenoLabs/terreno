## Properties

### access

> **access**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

***

### accountSecurity?

> `optional` **accountSecurity?**: [`AccountSecurityApp`](../classes/AccountSecurityApp.md)

The app's AccountSecurityApp. When set, org-admins get the member recovery routes at
`{basePath}/:orgId/members/:userId/security/*`. TerrenoApp passes the registered one.

***

### basePath?

> `optional` **basePath?**: `string`

***

### onOrgAudit?

> `optional` **onOrgAudit?**: (`event`, `req`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### event

[`OrgAuditEvent`](OrgAuditEvent.md)

##### req

`Request`

#### Returns

`void` \| `Promise`\<`void`\>

***

### orgRecovery?

> `optional` **orgRecovery?**: [`OrgRecoveryOptions`](OrgRecoveryOptions.md)

Hardening for the org-admin recovery routes, such as `{minMembershipDays: 7}`.

***

### settingsSchema?

> `optional` **settingsSchema?**: `Schema`\<`any`, `Model`\<`any`, `any`, `any`, `any`, `any`, `any`, `any`\>, \{ \}, \{ \}, \{ \}, \{ \}, `DefaultSchemaOptions`, \{\[`key`: `number`\]: `unknown`;
\[`key`: `symbol`\]: `unknown`;
\[`key`: `string`\]: `unknown`; \}, `Document`\<`unknown`, \{ \}, \{\[`key`: `number`\]: `unknown`;
\[`key`: `symbol`\]: `unknown`;
\[`key`: `string`\]: `unknown`; \}, \{ \}, `DefaultSchemaOptions`\> & `Omit`\<`object` & `Required`\<\{ \}\> & `object`, `"id"`\> & `HydratedDocumentOverrides`\<\{ \}\>, `unknown`, `object` & `Required`\<\{ \}\> & `object`\>

Nested schema for `Organization.settings`. Same as `registerOrganizationSettings`.

***

### userModel

> **userModel**: [`UserModel`](UserModel.md)
