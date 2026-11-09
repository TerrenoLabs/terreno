> **createStorageAdapter**(`isWeb?`): [`StorageAdapter`](../interfaces/StorageAdapter.md)

Storage adapter for Better Auth that works on both web and native.
Uses SecureStore on native platforms and AsyncStorage on web.

The native branch must be **synchronous**: `@better-auth/expo`'s client plugin reads the
cookie jar inline (`getCookie(storage.getItem(name) || "{}")` followed by `JSON.parse`)
while building request headers, and it sets `credentials: "omit"` on native so that
stored jar is the only way a session token reaches the server. A promise-returning
`getItem` fails the parse, yielding an empty jar and unauthenticated requests.
`expo-secure-store` exposes sync `getItem`/`setItem` alongside the `*Async` variants.

The web branch stays async: the plugin short-circuits on web (`if (isWeb) return`) and
lets the browser manage cookies, so it never reads this adapter there.

`isWeb` is exposed as a parameter so the adapter can be unit tested
without having to re-load the module for each platform.

## Parameters

### isWeb?

`boolean` = `IsWeb`

## Returns

[`StorageAdapter`](../interfaces/StorageAdapter.md)
