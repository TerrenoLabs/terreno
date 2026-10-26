The capability a registered plugin offers when it owns the app's Better Auth instance, as
BetterAuthApp does. TerrenoApp mounts its session middleware and RealtimeApp validates socket
sessions with it, so both find the provider the same way: [findBetterAuthProvider](../functions/findBetterAuthProvider.md).

## Properties

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

### markSessionMiddlewareMounted?

> `optional` **markSessionMiddlewareMounted?**: () => `void`

#### Returns

`void`
