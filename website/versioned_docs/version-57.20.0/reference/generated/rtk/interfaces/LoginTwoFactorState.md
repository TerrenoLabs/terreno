The inline two-factor challenge, for `TwoFactorChallengeScreen`.

## Properties

### accountLabel?

> `optional` **accountLabel?**: `string`

Email the code is for, when this sign-in was by email.

***

### error?

> `optional` **error?**: `string`

***

### initialTrustDevice?

> `optional` **initialTrustDevice?**: `boolean`

Whether "Trust this device" starts checked. Unset lets the screen check it for an
authenticator code.

***

### loading

> **loading**: `boolean`

***

### onCancel

> **onCancel**: () => `void`

Returns to the login screen.

#### Returns

`void`

***

### onSubmit

> **onSubmit**: (`values`) => `Promise`\<`void`\>

#### Parameters

##### values

`TwoFactorChallengeSubmission`

#### Returns

`Promise`\<`void`\>

***

### twoFactorMethods?

> `optional` **twoFactorMethods?**: `string`[]
