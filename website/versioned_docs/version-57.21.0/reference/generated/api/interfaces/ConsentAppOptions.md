## Properties

### accessControl?

> `optional` **accessControl?**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

RBAC access control. When set, users whose roles grant `consentResponse:signOnBehalf` may
record provisional signatures for other users. When unset, only `user.admin` may.

***

### aiConfig?

> `optional` **aiConfig?**: `object`

#### generateContent

> **generateContent**: (`params`) => `Promise`\<`string`\>

##### Parameters

###### params

###### description

`string`

###### locale

`string`

###### type

`string`

##### Returns

`Promise`\<`string`\>

#### translateContent

> **translateContent**: (`params`) => `Promise`\<`string`\>

##### Parameters

###### params

###### content

`string`

###### fromLocale

`string`

###### toLocale

`string`

##### Returns

`Promise`\<`string`\>

***

### auditTrail?

> `optional` **auditTrail?**: `boolean`

***

### resolveConsentForms?

> `optional` **resolveConsentForms?**: [`ResolveConsentForms`](../type-aliases/ResolveConsentForms.md)

***

### supportedLocales?

> `optional` **supportedLocales?**: `string`[]
