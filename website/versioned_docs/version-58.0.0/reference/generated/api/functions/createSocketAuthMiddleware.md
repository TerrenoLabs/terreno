> **createSocketAuthMiddleware**(`__namedParameters`): (`socket`, `next`) => `void`

Build the Socket.io auth middleware from a validator chain: validators run in order and
the first success wins; when all fail the connection is rejected with the last error.

## Parameters

### \_\_namedParameters

#### betterAuth?

[`BetterAuthSocketOptions`](../interfaces/BetterAuthSocketOptions.md)

Enables the Better Auth session validator after the legacy JWT validator.

#### extraValidators?

[`SocketAuthValidator`](../type-aliases/SocketAuthValidator.md)[] = `[]`

Additional validators appended to the chain (after JWT and Better Auth).

#### issuer?

`string` \| (() => `string` \| `undefined`)

JWT issuer to require (D1 parity with the HTTP path's `jwt.verify(token, secret,
{issuer})`). Omitted means no issuer check, matching pre-D1 behavior. A thunk is
resolved fresh on every handshake (see [createLegacyJwtValidator](createLegacyJwtValidator.md)).

#### tokenSecret?

`string`

Secret enabling the legacy JWT validator (same handling as before the refactor).

#### userModel?

[`UserModel`](../interfaces/UserModel.md)

Application user model. When set, the legacy JWT validator refuses tokens whose user is
missing or disabled.

## Returns

(`socket`, `next`) => `void`
