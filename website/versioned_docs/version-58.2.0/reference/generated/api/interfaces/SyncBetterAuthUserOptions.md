## Properties

### password?

> `optional` **password?**: `string`

The plaintext password from the sign-up or sign-in request being served. When an app User
with the same email is not linked yet and the Better Auth email is unverified, the user is
linked only if this password verifies against that User's passport-local-mongoose hash.
Never stored or logged.

***

### trustEmail?

> `optional` **trustEmail?**: `boolean`

Link an existing app user by email even when Better Auth has not verified the address or
the row is bound to another Better Auth id. Only for operator-run seeds that create the
Better Auth account themselves; never set it for a request-driven sync.
