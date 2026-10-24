## Properties

### baseUrl

> **baseUrl**: `string`

***

### captureEvent?

> `optional` **captureEvent?**: (`eventName`, `data`) => `void`

#### Parameters

##### eventName

`string`

##### data

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### getAuthToken?

> `optional` **getAuthToken?**: () => `Promise`\<`string` \| `null`\>

Reads the token for the handshake. When passed, the hook keeps its legacy behavior: it
reads the token once per `connectSocket` call, sends it as a static `auth` payload, and
refreshes the JWT when it is near expiry. Omit it to use a token source instead (see
`tokenSource`).

#### Returns

`Promise`\<`string` \| `null`\>

***

### onConnect?

> `optional` **onConnect?**: () => `void`

#### Returns

`void`

***

### onConnectError?

> `optional` **onConnectError?**: (`error`) => `void`

#### Parameters

##### error

`Error`

#### Returns

`void`

***

### onDisconnect?

> `optional` **onDisconnect?**: () => `void`

#### Returns

`void`

***

### onReconnectFailed?

> `optional` **onReconnectFailed?**: () => `void`

#### Returns

`void`

***

### shouldConnect

> **shouldConnect**: `boolean`

***

### tokenSource?

> `optional` **tokenSource?**: `AuthProvider`

Token source the hook reads when `getAuthToken` is omitted. Defaults to the source
registered with `setTokenSource`, else the built-in JWT source. The handshake re-reads
`getToken()` on every connect and reconnect. On an auth `connect_error` the hook calls
`refresh()` once and reconnects; a second auth failure before a successful connect stops
reconnecting and calls `onConnectError`. When `onAuthChange` fires with a different token, it
drops a live connection and reconnects with the new token; with no token it disconnects.
Pass a stable reference (not a new object per render) so the hook does not re-subscribe.
