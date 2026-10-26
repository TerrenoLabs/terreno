Minimal interface for the Better Auth client used by the Redux slice.
This interface defines only the methods needed by the slice, allowing
tests to use mock clients without importing React Native.

## Properties

### getSession

> **getSession**: () => `Promise`\<\{ `data?`: \{ `session?`: [`BetterAuthSession`](BetterAuthSession.md); `user?`: [`BetterAuthUser`](BetterAuthUser.md); \}; \}\>

#### Returns

`Promise`\<\{ `data?`: \{ `session?`: [`BetterAuthSession`](BetterAuthSession.md); `user?`: [`BetterAuthUser`](BetterAuthUser.md); \}; \}\>

***

### signOut

> **signOut**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
