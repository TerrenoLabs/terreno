> **hmacSignature**(`options`): (`req`) => `boolean`

Verifies `header` against HMAC of `req.rawBody`.
When `timestampHeader` is set, the MAC is HMAC(`${timestamp}.${rawBody}`) and
timestamps outside `toleranceSec` (default 300) are rejected.

## Parameters

### options

[`HmacSignatureOptions`](../interfaces/HmacSignatureOptions.md)

## Returns

(`req`) => `boolean`
