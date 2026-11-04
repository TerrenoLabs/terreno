Configuration for generating the Better Auth slice.

## Properties

### apisToReset?

> `optional` **apisToReset?**: [`ResettableApi`](ResettableApi.md)[]

RTK Query APIs whose cached responses belong to the signed-in user. Their caches are purged
on logout, when a sync finds the session gone, and when the session changes to another user,
so one account never sees responses fetched for another.

***

### authClient

> **authClient**: [`BetterAuthClientInterface`](BetterAuthClientInterface.md)

The Better Auth client instance.

***

### signOutTimeoutMs?

> `optional` **signOutTimeoutMs?**: `number`

How long `logout()` waits for the server's sign-out, and for the session check after a
failed one, before treating it as unreachable.

#### Default

```ts
10000
```

***

### syncInterval?

> `optional` **syncInterval?**: `number`

How often to sync the session state (in milliseconds).

#### Default

```ts
60000 (1 minute)
```
