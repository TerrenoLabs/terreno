## Properties

### accessControl?

> `optional` **accessControl?**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

RBAC access control. Platform routes require `user:manageSecurity`. Defaults to the
TerrenoApp's `accessControl`; without either, they require `admin: true`.

***

### actions?

> `optional` **actions?**: [`SecurityRouteAction`](SecurityRouteAction.md)[]

Extra recovery actions, mounted and listed after the built-in ones.

***

### audit?

> `optional` **audit?**: `boolean`

Pass `false` to run without AuditApp. Otherwise registration throws unless AuditApp is
registered, because every recovery action must leave an audit record.

***

### basePath?

> `optional` **basePath?**: `string`

Prefix for the platform routes. Defaults to `/users`.

***

### getBetterAuth?

> `optional` **getBetterAuth?**: () => `Auth`\<`BetterAuthOptions`\> \| `undefined`

Better Auth instance. Defaults to the registered BetterAuthApp's. Required outside
TerrenoApp (setupServer); without it every Better Auth feature reads as off.

#### Returns

`Auth`\<`BetterAuthOptions`\> \| `undefined`

***

### notifications?

> `optional` **notifications?**: [`SecurityNotificationsOptions`](SecurityNotificationsOptions.md)

Security notification emails: every recorded security action (admin recovery and the user's
own changes) emails the affected user. On by default whenever `sendMail` is configured; the
org name is left out unless `includeOrgName` is true.

***

### publicAppUrl?

> `optional` **publicAppUrl?**: `string`

App page base for `issue-sign-in-link` URLs (`{publicAppUrl}/resetPassword?token=`). Defaults
to the registered BetterAuthApp's `publicAppUrl`.

***

### userModel?

> `optional` **userModel?**: [`UserModel`](UserModel.md)

App User model. Defaults to the TerrenoApp's `userModel`.
