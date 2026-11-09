## Properties

### betterAuth?

> `optional` **betterAuth?**: [`BetterAuthSocketOptions`](BetterAuthSocketOptions.md)

Enables re-validating Better Auth-authenticated sockets.

***

### logInfo?

> `optional` **logInfo?**: (`message`) => `void`

#### Parameters

##### message

`string`

#### Returns

`void`

***

### sync?

> `optional` **sync?**: [`SyncAppOptions`](SyncAppOptions.md)

Active SyncAppOptions (for `getUserScopes`), used by D4's room re-resolution.

***

### userModel?

> `optional` **userModel?**: [`UserModel`](UserModel.md)

Application user model, for reloading the full user and its `disabled` flag.
