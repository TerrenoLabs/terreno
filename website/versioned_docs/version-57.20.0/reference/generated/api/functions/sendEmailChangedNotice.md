> **sendEmailChangedNotice**(`__namedParameters`): `Promise`\<`void`\>

Tell the previous address that the account email changed. The notice carries no link or token
that acts on the account. Without a configured `sendMail` it logs a warning and sends nothing;
a delivery failure is logged and never undoes the change.

## Parameters

### \_\_namedParameters

#### authOptions?

[`AuthOptions`](../interfaces/AuthOptions.md)

#### newEmail

`string`

#### previousEmail

`string`

## Returns

`Promise`\<`void`\>
