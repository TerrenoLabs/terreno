# Receive inbound webhooks

Register provider callbacks on `WebhooksApp`. Signatures use `req.rawBody` — never
`JSON.stringify(req.body)`.

```typescript
import {hmacSignature, TerrenoApp, WebhooksApp} from "@terreno/api";

const webhooks = new WebhooksApp({idempotency: {store: "mongo"}});
webhooks.route({
  path: "/webhooks/example",
  source: "example",
  verify: hmacSignature({secret: process.env.WEBHOOK_SECRET!, header: "X-Webhook-Signature"}),
  eventId: (req) => String((req.body as {id?: string})?.id ?? ""),
  handler: async () => undefined,
});

new TerrenoApp({userModel: User}).register(webhooks).start();
```

`@terreno/api` does **not** read `WEBHOOK_SECRET`. The example backend registers
`POST /webhooks/example` only when that env is set.

## Register Twilio and SendGrid through CommsApp

Build one `WebhooksApp`, pass it into `CommsApp`, then register the plugin **after**
`CommsApp` so the extra routes mount:

```typescript
const webhooks = new WebhooksApp({idempotency: {store: "mongo"}});

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      mail: new SendGridMailProvider(),
      sms: new TwilioSmsProvider(),
      webhookPublicUrl: process.env.PUBLIC_API_URL,
      webhooks,
    })
  )
  .register(webhooks)
  .start();
```

| Adapter | Path (default `basePath` `/comms`) | Signature |
|---------|--------------------------------------|-----------|
| `TwilioSmsProvider` | `POST /comms/webhooks/twilio/status` and `.../inbound` | `twilioSignature` — public URL must match the Twilio callback |
| `SendGridMailProvider` | `POST /comms/webhooks/sendgrid` | ECDSA; `SENDGRID_WEBHOOK_VERIFICATION_KEY` or `webhookVerificationKey` |

Set `webhookPublicUrl`, `PUBLIC_API_URL`, or `COMMS_WEBHOOK_PUBLIC_URL` to the public
HTTPS origin (Cloud Run URL, no trailing slash). Twilio HMAC includes that origin plus
path. Missing Twilio auth token, public URL, or SendGrid verification key skips that
provider's routes and logs an error.

Expo push **polls receipts** — it does not use inbound HTTP.

Stripe billing webhooks stay on `billing-stripe` at `POST /billing/webhooks/stripe`.

## Verifiers

| Helper | Header | Algorithm |
|--------|--------|-----------|
| `hmacSignature({secret, header, timestampHeader?})` | caller-chosen | HMAC of `rawBody`, or `${timestamp}.${rawBody}` when `timestampHeader` is set. Optional skew (default 300s). |
| `stripeSignature({secret, toleranceSec?})` | `Stripe-Signature` | HMAC-SHA256 of `${t}.${rawBody}`. Default 300s timestamp window. |
| `twilioSignature({authToken, url})` | `X-Twilio-Signature` | HMAC-SHA1 base64 of callback URL + sorted POST fields. Form-urlencoded only. |
| `sendgridEventSignature({publicKey, toleranceSec?})` | `X-Twilio-Email-Event-Webhook-Signature` + timestamp | ECDSA P-256 over `${timestamp}${rawBody}`. Default 300s timestamp window. |

Invalid or missing signatures return `401` with `code: "webhook-signature-invalid"`.
Missing `rawBody` returns `400` `webhook-body-missing`. Duplicate `(source, eventId)`
returns `200 {received: true, duplicate: true}` without running the handler. A throwing
handler returns `500` and **releases** the claim so a retry can run.

Pass `idempotency: {store: "mongo", ttlDays?}` to persist claims in the `webhookReceipts` collection
(unique `(source, eventId)`, TTL on `created`, default 7 days). This is not a public `modelRouter`
model. Use `store: "memory"` in tests and single-process apps.

SendGrid posts an array. Omit route-level `eventId` and call `webhooks.claim({source, eventId})`
per `sg_event_id` inside the handler (release on throw).

Webhook POSTs are anonymous (no JWT). They are **not** listed in `/openapi.json` and are
**not** skipped by the rate limiter.

See [@terreno/comms](../reference/comms.md) for Twilio/SendGrid mapping tables.
