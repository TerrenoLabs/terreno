> **recordRememberedSignIn**(`__namedParameters`): `Promise`\<`void`\>

Records a sign-in in the remembered-accounts store. The controller calls it after every
sign-in it finishes; call it yourself after a sign-in finished elsewhere, such as an app's own
two-factor screen (`method: "email"`).

## Parameters

### \_\_namedParameters

#### method

`string`

#### rememberIdentity?

`boolean` = `true`

#### store

[`RememberedAccountsStore`](../interfaces/RememberedAccountsStore.md)

#### user

[`LoginUser`](../interfaces/LoginUser.md)

## Returns

`Promise`\<`void`\>
