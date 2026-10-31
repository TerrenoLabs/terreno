## Properties

### methods

> **methods**: [`BetterAuthMethods`](BetterAuthMethods.md) \| `undefined`

The server's methods; undefined while they load or after an error.

***

### refetch

> **refetch**: () => `Promise`\<`void`\>

Reloads every section.

#### Returns

`Promise`\<`void`\>

***

### screenProps

> **screenProps**: [`AccountSecurityControllerScreenProps`](../type-aliases/AccountSecurityControllerScreenProps.md)

Spread into `AccountSecurityScreen`. A card's props are undefined when it is hidden.

***

### user

> **user**: [`AccountSecurityUser`](AccountSecurityUser.md) \| `undefined`

The signed-in user, once the session loads.
