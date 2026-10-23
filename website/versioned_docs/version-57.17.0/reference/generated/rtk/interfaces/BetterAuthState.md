Better Auth Redux state interface.

## Properties

### error

> **error**: `string` \| `null`

Last error message, if any.

***

### isAuthenticated

> **isAuthenticated**: `boolean`

Whether the user is authenticated.

***

### isLoading

> **isLoading**: `boolean`

Whether the auth state is currently loading.

***

### lastSyncTimestamp

> **lastSyncTimestamp**: `number` \| `null`

Timestamp of the last session sync.

***

### user

> **user**: [`BetterAuthUser`](BetterAuthUser.md) \| `null`

The authenticated user data, or null if not authenticated.

***

### userId

> **userId**: `string` \| `null`

The authenticated user's ID, or null if not authenticated.
