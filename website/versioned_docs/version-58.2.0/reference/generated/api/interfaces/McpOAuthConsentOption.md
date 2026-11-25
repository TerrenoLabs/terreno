`mcpOAuth.consent`: who may approve a connection.

## Properties

### mode?

> `optional` **mode?**: `"url"` \| `"builtin"`

`"builtin"` serves a consent page from the API that asks for email, password, and an
authenticator code on every approval; it needs a `BetterAuthApp` with `twoFactor`.
`"url"` (default) redirects to `consentUrl`.

***

### requireAdmin?

> `optional` **requireAdmin?**: `boolean`

Only users with `admin: true` may approve. Default false.

***

### requireTwoFactor?

> `optional` **requireTwoFactor?**: `boolean`

Only users with Better Auth two-factor enabled may approve. Default false. Needs a registered
`BetterAuthApp` whose config sets `twoFactor`, or the app throws at boot.
