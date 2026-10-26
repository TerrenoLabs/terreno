> **stripeSignature**(`options`): (`req`) => `boolean`

Verifies Stripe `Stripe-Signature` (`t=` / `v1=`) against HMAC-SHA256 of `${t}.${rawBody}`.

## Parameters

### options

[`StripeSignatureOptions`](../interfaces/StripeSignatureOptions.md)

## Returns

(`req`) => `boolean`
