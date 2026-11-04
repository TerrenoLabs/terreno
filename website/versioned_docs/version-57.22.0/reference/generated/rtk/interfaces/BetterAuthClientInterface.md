Minimal interface for the Better Auth client used by the Redux slice.
This interface defines only the methods needed by the slice, allowing
tests to use mock clients without importing React Native.

## Properties

### getSession

> **getSession**: () => `Promise`\<\{ `data?`: \{ `session?`: `Partial`\<[`BetterAuthSession`](BetterAuthSession.md)\>; `user?`: `Omit`\<[`BetterAuthUser`](BetterAuthUser.md), `"image"`\> & `object`; \} \| `null`; \}\>

#### Returns

`Promise`\<\{ `data?`: \{ `session?`: `Partial`\<[`BetterAuthSession`](BetterAuthSession.md)\>; `user?`: `Omit`\<[`BetterAuthUser`](BetterAuthUser.md), `"image"`\> & `object`; \} \| `null`; \}\>

***

### signOut

> **signOut**: () => `Promise`\<`unknown`\>

#### Returns

`Promise`\<`unknown`\>
