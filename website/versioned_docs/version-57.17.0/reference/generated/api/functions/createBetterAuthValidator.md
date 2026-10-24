> **createBetterAuthValidator**(`options`): [`SocketAuthValidator`](../type-aliases/SocketAuthValidator.md)

Better Auth session validator: treats the handshake token as a Better Auth session token
and validates it via `auth.api.getSession` (the same lookup the HTTP session middleware
uses). The token is presented both as a bearer Authorization header (for the Better Auth
bearer plugin) and as the session cookie, so either transport configuration works.

## Parameters

### options

[`BetterAuthSocketOptions`](../interfaces/BetterAuthSocketOptions.md)

## Returns

[`SocketAuthValidator`](../type-aliases/SocketAuthValidator.md)
