## Properties

### clear

> **clear**: () => `Promise`\<`void`\>

Removes every remembered account and the storage key.

#### Returns

`Promise`\<`void`\>

***

### dispose

> **dispose**: () => `void`

Stops listening for changes made in other browser tabs.

#### Returns

`void`

***

### forget

> **forget**: (`userId`) => `Promise`\<`void`\>

Removes one account from this device.

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### getSnapshot

> **getSnapshot**: () => [`RememberedAccountsSnapshot`](RememberedAccountsSnapshot.md)

#### Returns

[`RememberedAccountsSnapshot`](RememberedAccountsSnapshot.md)

***

### isHydrated

> **isHydrated**: () => `boolean`

#### Returns

`boolean`

***

### lastUsedMethod

> **lastUsedMethod**: () => `string` \| `undefined`

The newest account's method, or undefined.

#### Returns

`string` \| `undefined`

***

### list

> **list**: () => [`RememberedAccount`](RememberedAccount.md)[]

Remembered accounts, most recently used first.

#### Returns

[`RememberedAccount`](RememberedAccount.md)[]

***

### ready

> **ready**: `Promise`\<`void`\>

Resolves once storage has loaded.

***

### record

> **record**: (`entry`) => `Promise`\<`void`\>

Records a sign-in, replacing any earlier entry for the same user.

#### Parameters

##### entry

[`RememberedAccountInput`](RememberedAccountInput.md)

#### Returns

`Promise`\<`void`\>

***

### subscribe

> **subscribe**: (`listener`) => () => `void`

Calls `listener` after every change. Returns an unsubscribe function.

#### Parameters

##### listener

() => `void`

#### Returns

() => `void`
