## Properties

### api

> **api**: `GenericApi`

The RTK Query API instance

***

### endpoints

> **endpoints**: `string`[]

RTK Query mutation endpoint names to queue when offline

***

### tokenSource?

> `optional` **tokenSource?**: `AuthProvider`

Token source for queued mutations. Defaults to the source registered with `setTokenSource`,
else the built-in JWT source. With the JWT source the middleware reads `state.auth.userId`
and the stored JWT, as before. With any other source (for example syncdb's
`betterAuthAdapter`), each queued mutation is tagged with the source's `getUserId()` and
replayed only while that same user is signed in, with `Authorization: Bearer` from the
source's `getToken()` (omitted when it returns null). The last user id the source confirmed
is kept in `state.offline.lastUserId`, refreshed on the first action, on rehydrate, on
`onAuthChange` and on reconnect, so a session read that fails while offline does not untag
new mutations. To tag mutations made after an app launches offline, persist the `offline`
slice with redux-persist (do not blacklist it); otherwise those mutations carry no user and
are dropped on reconnect. A rehydrated id is unconfirmed until a read in this process
returns a user: mutations tagged with it carry `userIdConfirmed: false`. A later read keeps
them only if it names the same user and no `onAuthChange` or source swap happened since; any
auth change drops them, even for the same user, so they are kept only when the reconnect read
confirms them first. syncdb's `betterAuthAdapter` fires `onAuthChange` on the session's first
successful load, which after an offline launch happens once the network returns, so that
event drops offline-launch writes the reconnect read has not confirmed yet. The one remaining risk needs the signed-in user to change while no
running instance of this middleware observes it (for example in another browser tab sharing
the persisted `offline` slice) between an unconfirmed write and the next launch's first read.
A sign-out (the source reporting
no user after `onAuthChange`), `auth/logout` or the Better Auth slice's `betterAuth/logout`
clears the queue, conflicts and last user id, and discards in-flight enqueues and replays.
When the source has no user on reconnect, or the user changes during a replay, the remaining
queue is kept for a later reconnect, and it replays only for the user who queued it. A
mutation still waiting on a user id read gets no user if the user changes first.
