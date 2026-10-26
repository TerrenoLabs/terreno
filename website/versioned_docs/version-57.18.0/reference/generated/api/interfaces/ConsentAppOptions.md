## Properties

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

> `optional` **resolveConsentForms?**: (`user`, `forms`) => [`ConsentFormDocument`](ConsentFormDocument.md)[] \| `Promise`\<[`ConsentFormDocument`](ConsentFormDocument.md)[]\>

#### Parameters

##### user

[`User`](User.md)

##### forms

[`ConsentFormDocument`](ConsentFormDocument.md)[]

#### Returns

[`ConsentFormDocument`](ConsentFormDocument.md)[] \| `Promise`\<[`ConsentFormDocument`](ConsentFormDocument.md)[]\>

***

### supportedLocales?

> `optional` **supportedLocales?**: `string`[]
