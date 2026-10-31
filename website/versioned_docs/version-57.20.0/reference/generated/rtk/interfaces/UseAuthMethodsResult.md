## Properties

### error

> **error**: `string` \| `undefined`

A readable message when the request failed.

***

### isLoading

> **isLoading**: `boolean`

***

### methods

> **methods**: [`BetterAuthMethods`](BetterAuthMethods.md) \| `undefined`

Set once the server answers; `undefined` while loading and after an error.

***

### refetch

> **refetch**: () => `void`

Requests the methods again, for a Try again button after an error.

#### Returns

`void`
