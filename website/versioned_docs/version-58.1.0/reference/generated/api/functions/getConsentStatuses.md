> **getConsentStatuses**(`__namedParameters`): `Promise`\<[`ConsentStatusRow`](../interfaces/ConsentStatusRow.md)[]\>

Consent status for every active form that applies to the user, in form order. Only
non-voided responses to each form's current version count. The user's own latest response decides
(`signed` or `declined`); otherwise a provisional signature makes it `provisional`, which
counts as consented; otherwise `pending`.

## Parameters

### \_\_namedParameters

#### resolveConsentForms?

[`ResolveConsentForms`](../type-aliases/ResolveConsentForms.md)

#### userId

`string`

## Returns

`Promise`\<[`ConsentStatusRow`](../interfaces/ConsentStatusRow.md)[]\>
