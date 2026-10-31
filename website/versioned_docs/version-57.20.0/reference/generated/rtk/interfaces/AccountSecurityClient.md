The part of a Better Auth client the hook calls. A client from `createBetterAuthClient`
satisfies it; `passkey` and `twoFactor` exist when those `features` are on, and the hook leaves
out the card of a namespace that is missing.

## Extends

- [`AuthMethodsClient`](AuthMethodsClient.md)

## Properties

### passkey?

> `optional` **passkey?**: `object`

#### addPasskey()

> **addPasskey**(`options?`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\> \| `undefined`\>

##### Parameters

###### options?

###### name?

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\> \| `undefined`\>

#### deletePasskey()

> **deletePasskey**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

##### Parameters

###### body

###### id

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

#### listUserPasskeys()

> **listUserPasskeys**(): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`AccountPasskey`[]\>\>

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`AccountPasskey`[]\>\>

#### updatePasskey()

> **updatePasskey**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

##### Parameters

###### body

###### id

`string`

###### name

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

***

### twoFactor?

> `optional` **twoFactor?**: `object`

#### disable()

> **disable**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

##### Parameters

###### body

###### password

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

#### enable()

> **enable**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`object`\>\>

##### Parameters

###### body

###### password

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`object`\>\>

#### generateBackupCodes()

> **generateBackupCodes**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<\{ `backupCodes`: `string`[]; \}\>\>

##### Parameters

###### body

###### password

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<\{ `backupCodes`: `string`[]; \}\>\>

#### verifyTotp()

> **verifyTotp**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

##### Parameters

###### body

###### code

`string`

##### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

## Methods

### $fetch()

> **$fetch**(`path`, `options?`): `Promise`\<\{ `data`: `unknown`; `error`: `unknown`; \}\>

#### Parameters

##### path

`string`

##### options?

###### body?

`Record`\<`string`, `unknown`\>

###### method?

`"POST"` \| `"GET"`

#### Returns

`Promise`\<\{ `data`: `unknown`; `error`: `unknown`; \}\>

#### Overrides

`AuthMethodsClient.$fetch`

***

### changePassword()

> **changePassword**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

#### Parameters

##### body

###### currentPassword

`string`

###### newPassword

`string`

###### revokeOtherSessions?

`boolean`

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

***

### getSession()

> **getSession**(`options?`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<[`AccountSecuritySessionData`](AccountSecuritySessionData.md) \| `null`\>\>

#### Parameters

##### options?

###### query?

\{ `disableCookieCache?`: `boolean`; \}

###### query.disableCookieCache?

`boolean`

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<[`AccountSecuritySessionData`](AccountSecuritySessionData.md) \| `null`\>\>

***

### linkSocial()

> **linkSocial**(`body`): `Promise`\<\{ `error`: \{ `code?`: `string`; `message?`: `string`; `status`: `number`; \} \| `null`; \}\>

#### Parameters

##### body

###### callbackURL

`string`

###### errorCallbackURL?

`string`

###### provider

`string`

#### Returns

`Promise`\<\{ `error`: \{ `code?`: `string`; `message?`: `string`; `status`: `number`; \} \| `null`; \}\>

***

### listAccounts()

> **listAccounts**(): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<[`AccountSecurityAccountRow`](AccountSecurityAccountRow.md)[]\>\>

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<[`AccountSecurityAccountRow`](AccountSecurityAccountRow.md)[]\>\>

***

### listSessions()

> **listSessions**(): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`AccountSession`[]\>\>

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`AccountSession`[]\>\>

***

### revokeOtherSessions()

> **revokeOtherSessions**(): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

***

### revokeSession()

> **revokeSession**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

#### Parameters

##### body

###### token

`string`

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

***

### unlinkAccount()

> **unlinkAccount**(`body`): `Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>

#### Parameters

##### body

###### accountId

`string`

#### Returns

`Promise`\<[`AccountSecurityClientResult`](AccountSecurityClientResult.md)\<`unknown`\>\>
