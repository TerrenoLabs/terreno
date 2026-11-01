Options for the RealtimeApp plugin.

## Properties

### adapter?

> `optional` **adapter?**: `"redis"` \| `"none"`

Socket.io adapter for multi-instance deployments.
- 'none': single-instance mode, no adapter (default)
- 'redis': use Redis adapter (requires redisUrl or VALKEY_URL env var)

For MongoDB adapter or custom adapters, configure the Socket.io instance
directly via getIo() after server creation.

***

### betterAuth?

> `optional` **betterAuth?**: [`BetterAuthSocketOptions`](BetterAuthSocketOptions.md)

Enables the Better Auth session validator for socket authentication. It is tried after
the legacy JWT validator when a token secret exists, or used alone otherwise. Usually
omitted: when a BetterAuthApp is registered on the same TerrenoApp, its instance and the
RealtimeApp's `userModel` (else the TerrenoApp's) are used automatically. Pass the instance returned by
`createBetterAuth` only for a RealtimeApp mounted without TerrenoApp, or to override it.

***

### changeStream?

> `optional` **changeStream?**: [`ChangeStreamConfig`](ChangeStreamConfig.md)

Change stream watcher configuration

***

### cors?

> `optional` **cors?**: `object`

CORS configuration for Socket.io

#### methods?

> `optional` **methods?**: `string`[]

#### origin

> **origin**: `string` \| `string`[]

***

### debug?

> `optional` **debug?**: `boolean`

Enable debug logging

***

### redisUrl?

> `optional` **redisUrl?**: `string`

Redis URL for the Redis adapter

***

### sessionRevalidationIntervalMs?

> `optional` **sessionRevalidationIntervalMs?**: `number`

Interval in ms for the periodic socket session re-validation sweep (D1): re-checks
JWT expiry / Better Auth session validity and the user's `disabled` flag for every
connected socket, disconnecting (`sync:auth-expired` then `disconnect(true)`) any
socket that fails. Also refreshes `socket.data.fullUser` (D2) and re-resolves sync
stream membership, leaving rooms for streams no longer held (D4). Default 60_000ms;
set to 0 to disable the sweep entirely (e.g. in tests).

***

### SocketServer?

> `optional` **SocketServer?**: *typeof* `Server`

Test seam: Socket.IO server constructor. Defaults to `socket.io`'s `Server`.
Prefer this over `mock.module("socket.io")` — bun's module mocks are process-wide
and break later files that need a real Socket.IO server (sync integration, etc.).

***

### startChangeStreamWatcher?

> `optional` **startChangeStreamWatcher?**: (`io`, `config`, `debug`) => `void`

Test seam: change-stream watcher starter. Defaults to the real
`startChangeStreamWatcher`. Same rationale as [SocketServer](#socketserver) — avoid
process-wide `mock.module` of `./changeStreamWatcher`.

Start watching MongoDB change streams and emitting real-time events.

Task 9.16: the stream is supervised — an `error`/`close`/`end` schedules a re-open with
exponential backoff, resuming from the last seen token. Call
[stopChangeStreamWatcher](../functions/stopChangeStreamWatcher.md) to end supervision.

#### Parameters

##### io

`Server`

##### config?

[`ChangeStreamConfig`](ChangeStreamConfig.md) = `{}`

##### debug?

`boolean` = `false`

#### Returns

`void`

***

### sync?

> `optional` **sync?**: [`SyncAppOptions`](SyncAppOptions.md)

Explicit SyncAppOptions override for the sync socket handlers. Normally omitted —
the options registered by the SyncApp plugin are used automatically.

***

### tokenIssuer?

> `optional` **tokenIssuer?**: `string`

JWT issuer required for socket authentication (default: process.env.TOKEN_ISSUER),
for parity with the HTTP JWT path's `jwt.verify(token, secret, {issuer})` (D1).
Omit (and leave `TOKEN_ISSUER` unset) to skip the issuer check.

***

### tokenSecret?

> `optional` **tokenSecret?**: `string`

JWT secret for socket authentication (default: process.env.TOKEN_SECRET).
Optional when `betterAuth` is configured.

***

### userModel?

> `optional` **userModel?**: [`UserModel`](UserModel.md)

The application's Mongoose user model. When provided, the full user document is
loaded once at handshake (by the decoded token's id) and cached on
`socket.data.fullUser`, then refreshed by the periodic session re-validation sweep
(D1). Authorization for realtime/sync subscriptions and mutations uses this full
document instead of the synthetic `{_id, admin, id}` shape derived from the token
alone — required for any permission check or `getUserScopes` resolver that reads
fields beyond `admin` (e.g. `organizationIds` for tenant-scoped sync). The sweep also
disconnects sockets whose user was disabled or deleted. When omitted, the user model of
the TerrenoApp this RealtimeApp is registered on is used; without either, socket-side
authorization falls back to the synthetic shape (pre-D2 behavior).
