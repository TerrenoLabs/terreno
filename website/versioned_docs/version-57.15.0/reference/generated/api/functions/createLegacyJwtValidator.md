> **createLegacyJwtValidator**(`tokenSecret`, `issuer?`): [`SocketAuthValidator`](../type-aliases/SocketAuthValidator.md)

Legacy JWT validator: wraps the `@thream/socketio-jwt` middleware so its observable
behavior (token format requirements, secret verification, `decodedToken` payload,
`UnauthorizedError` shapes) is identical to the previous direct `io.use(authorize(...))`.

D1: `@thream/socketio-jwt`'s `authorize()` has no `issuer` option — it only verifies
the signature/algorithm — so without this the socket path silently accepted a
validly-signed token issued for a DIFFERENT `TOKEN_ISSUER` (e.g. a token from another
environment sharing the same `TOKEN_SECRET`), unlike the HTTP path's
`jwt.verify(token, secret, {issuer})`. When `issuer` is provided, the post-verify
`onAuthentication` hook checks `decodedToken.iss` and rejects a mismatch with the
same `UnauthorizedError` shape the signature-verification failure path uses, so
callers cannot distinguish "bad signature" from "wrong issuer" from the error alone
(matching the non-disclosure posture the HTTP path also has).

`issuer` may be a plain string or a thunk (`() => string | undefined`) resolved on
EVERY handshake — the HTTP path's `jwt.verify` reads `process.env.TOKEN_ISSUER` fresh
per request rather than once at server startup, and a static string captured once at
`RealtimeApp.onServerCreated()` time would go stale if `TOKEN_ISSUER` changes later
(e.g. test suites that mutate it between fixtures). Pass a thunk to preserve that
per-request freshness; a plain string is still supported for callers who intentionally
want a fixed value.

## Parameters

### tokenSecret

`string`

### issuer?

`string` \| (() => `string` \| `undefined`)

## Returns

[`SocketAuthValidator`](../type-aliases/SocketAuthValidator.md)
