## Properties

### continueAs

> **continueAs**: (`account`, `source`) => `Promise`\<`void`\>

#### Parameters

##### account

`LoginAccountOption`

##### source

`LoginAccountSource`

#### Returns

`Promise`\<`void`\>

***

### forget

> **forget**: (`account`) => `Promise`\<`void`\>

#### Parameters

##### account

`LoginAccountOption`

#### Returns

`Promise`\<`void`\>

***

### isEmailPasswordEnabled

> **isEmailPasswordEnabled**: `boolean`

False when the server has email and password sign-in off: render `LoginScreen` with
`fields={[]}` so the form is left out. True while the methods load.

***

### methods

> **methods**: [`BetterAuthMethods`](BetterAuthMethods.md) \| `undefined`

The server's sign-in methods; undefined while they load or after an error.

***

### screenProps

> **screenProps**: [`LoginControllerScreenProps`](../type-aliases/LoginControllerScreenProps.md)

***

### signInEmail

> **signInEmail**: (`values`) => `Promise`\<`void`\>

#### Parameters

##### values

`Record`\<`string`, `string`\>

#### Returns

`Promise`\<`void`\>

***

### signInPasskey

> **signInPasskey**: (`options?`) => `Promise`\<`void`\>

#### Parameters

##### options?

###### autoFill?

`boolean`

#### Returns

`Promise`\<`void`\>

***

### signInSocial

> **signInSocial**: (`provider`) => `Promise`\<`void`\>

#### Parameters

##### provider

`string`

#### Returns

`Promise`\<`void`\>

***

### step

> **step**: [`LoginControllerStep`](../type-aliases/LoginControllerStep.md)

***

### twoFactor

> **twoFactor**: [`LoginTwoFactorState`](LoginTwoFactorState.md)
