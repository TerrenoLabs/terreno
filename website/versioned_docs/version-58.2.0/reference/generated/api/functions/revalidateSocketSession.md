> **revalidateSocketSession**(`socket`, `options`): `Promise`\<[`RevalidationOutcome`](../type-aliases/RevalidationOutcome.md)\>

Re-run the cheap parts of the auth validator for an already-connected socket:
- JWT sockets (`decodedToken.authKind === "jwt"`): verify `exp` locally (no
  signature re-check — a stolen-but-still-valid token is not this sweep's job;
  revocation-by-expiry and disablement are).
- Better Auth sockets (`decodedToken.authKind === "better-auth"`): re-run
  `auth.api.getSession` for the retained session token.
Also reloads the user's `disabled` flag (and the full user document, refreshing
`socket.data.fullUser` for D2) when a `userModel` is configured.

## Parameters

### socket

[`RevalidatableSocket`](../interfaces/RevalidatableSocket.md)

### options

[`SessionRevalidationOptions`](../interfaces/SessionRevalidationOptions.md)

## Returns

`Promise`\<[`RevalidationOutcome`](../type-aliases/RevalidationOutcome.md)\>
