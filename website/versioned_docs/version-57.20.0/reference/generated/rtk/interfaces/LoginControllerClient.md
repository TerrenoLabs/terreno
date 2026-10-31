The part of a Better Auth client the controller calls. A client from `createBetterAuthClient`
satisfies it; `multiSession`, `twoFactor` and `signIn.passkey` exist when those `features` are
on, and the controller skips what is missing.

## Extends

- [`AuthMethodsClient`](AuthMethodsClient.md)

## Properties

### $fetch

> **$fetch**: (`path`, `options?`) => `Promise`\<\{ `data`: `unknown`; `error`: `unknown`; \}\>

#### Parameters

##### path

`string`

##### options?

###### method?

`"GET"`

#### Returns

`Promise`\<\{ `data`: `unknown`; `error`: `unknown`; \}\>

#### Inherited from

[`AuthMethodsClient`](AuthMethodsClient.md).[`$fetch`](AuthMethodsClient.md#fetch)

***

### getSession

> **getSession**: () => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `session?`: `unknown`; `user?`: [`LoginUser`](LoginUser.md); \} \| `null`\>\>

#### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `session?`: `unknown`; `user?`: [`LoginUser`](LoginUser.md); \} \| `null`\>\>

***

### multiSession?

> `optional` **multiSession?**: `object`

#### listDeviceSessions

> **listDeviceSessions**: () => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<[`LoginDeviceSession`](LoginDeviceSession.md)[]\>\>

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<[`LoginDeviceSession`](LoginDeviceSession.md)[]\>\>

#### setActive

> **setActive**: (`body`) => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<`unknown`\>\>

##### Parameters

###### body

###### sessionToken

`string`

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<`unknown`\>\>

***

### signIn

> **signIn**: `object`

#### email

> **email**: (`body`) => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `twoFactorMethods?`: `string`[]; `twoFactorRedirect?`: `boolean`; `user?`: [`LoginUser`](LoginUser.md); \}\>\>

##### Parameters

###### body

###### email

`string`

###### password

`string`

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `twoFactorMethods?`: `string`[]; `twoFactorRedirect?`: `boolean`; `user?`: [`LoginUser`](LoginUser.md); \}\>\>

#### passkey?

> `optional` **passkey?**: (`options?`) => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `user?`: [`LoginUser`](LoginUser.md); \}\>\>

##### Parameters

###### options?

###### autoFill?

`boolean`

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `user?`: [`LoginUser`](LoginUser.md); \}\>\>

#### social

> **social**: (`body`) => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `redirect?`: `boolean`; `url?`: `string`; \}\>\>

##### Parameters

###### body

###### callbackURL?

`string`

###### errorCallbackURL?

`string`

###### provider

`string`

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `redirect?`: `boolean`; `url?`: `string`; \}\>\>

***

### twoFactor?

> `optional` **twoFactor?**: `object`

#### verifyBackupCode

> **verifyBackupCode**: (`body`) => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `user?`: [`LoginUser`](LoginUser.md); \}\>\>

##### Parameters

###### body

###### code

`string`

###### trustDevice?

`boolean`

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `user?`: [`LoginUser`](LoginUser.md); \}\>\>

#### verifyTotp

> **verifyTotp**: (`body`) => `Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `user?`: [`LoginUser`](LoginUser.md); \}\>\>

##### Parameters

###### body

###### code

`string`

###### trustDevice?

`boolean`

##### Returns

`Promise`\<[`LoginClientResult`](LoginClientResult.md)\<\{ `user?`: [`LoginUser`](LoginUser.md); \}\>\>
