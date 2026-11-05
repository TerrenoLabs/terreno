The capability a registered plugin offers when it owns the app's Better Auth instance, as
BetterAuthApp does. TerrenoApp mounts its session middleware and RealtimeApp validates socket
sessions with it, so both find the provider the same way: [findBetterAuthProvider](../functions/findBetterAuthProvider.md).

## Properties

### adoptUserModel?

> `optional` **adoptUserModel?**: (`userModel`) => `void`

Hands the provider the host app's user model when it was given none of its own. TerrenoApp
calls it before anything creates the Better Auth instance.

#### Parameters

##### userModel

[`UserModel`](UserModel.md)

#### Returns

`void`

***

### ensureAuth?

> `optional` **ensureAuth?**: () => `Auth`

#### Returns

`Auth`

***

### getAuth

> **getAuth**: () => `Auth`\<`BetterAuthOptions`\> \| `undefined`

#### Returns

`Auth`\<`BetterAuthOptions`\> \| `undefined`

***

### getBetterAuthBasePath?

> `optional` **getBetterAuthBasePath?**: () => `string`

#### Returns

`string`

***

### getBetterAuthConfig?

> `optional` **getBetterAuthConfig?**: () => [`BetterAuthConfig`](BetterAuthConfig.md)

The Terreno config the instance was built from (for `publicAppUrl` and similar).

#### Returns

[`BetterAuthConfig`](BetterAuthConfig.md)

***

### markSessionMiddlewareMounted?

> `optional` **markSessionMiddlewareMounted?**: () => `void`

#### Returns

`void`
