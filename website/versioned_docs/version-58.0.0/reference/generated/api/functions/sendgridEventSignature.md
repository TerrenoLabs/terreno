> **sendgridEventSignature**(`options`): (`req`) => `boolean`

Verifies SendGrid Event Webhook ECDSA P-256 over `${timestamp}${rawBody}`.
Timestamps outside `toleranceSec` (default 300) are rejected.

## Parameters

### options

[`SendgridEventSignatureOptions`](../interfaces/SendgridEventSignatureOptions.md)

## Returns

(`req`) => `boolean`
