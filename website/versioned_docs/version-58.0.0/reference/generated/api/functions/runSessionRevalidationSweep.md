> **runSessionRevalidationSweep**(`io`, `options?`): `Promise`\<`void`\>

Run one sweep pass over every connected socket: re-validate the session (D1),
disconnecting (`sync:auth-expired` then `disconnect(true)`) any socket that fails,
and re-resolve sync room membership (D4) for sockets that remain valid.

## Parameters

### io

`Server`

### options?

[`SessionRevalidationOptions`](../interfaces/SessionRevalidationOptions.md) = `{}`

## Returns

`Promise`\<`void`\>
