# Implementation Plan: Inbound webhook framework

**Status:** Complete — shipped in #1251  
**Branch:** `cursor/inbound-webhooks-4945`  
**Owner:** —  
**Created:** 2026-09-01  
**Approved:** 2026-09-01  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1172 (this feature **closes** that issue; implementation PRs use `Fixes #1172`)  
**Task list:** [inbound-webhooks.md](../tasks/inbound-webhooks.md)  
**Depends on:** —  
**RTK deprecation flag:** None  
**Program:** [B2B platform](b2b-platform-program.md)  

## Goal

`@terreno/api` can receive signed HTTP callbacks from Stripe, Twilio, SendGrid, and
similar providers. Apps register webhook routes on a `WebhooksApp` plugin that captures
the raw body, verifies signatures, claims event ids so retries are no-ops, and dispatches
to a handler. `@terreno/comms` registers Twilio SMS and SendGrid Event Webhook routes on
that plugin and maps them through `recordDeliveryEvent` / `recordOptOut`. Stripe checkout
sync stays in `billing-stripe` Phase 3.

## Non-Goals

- Stripe **billing** handlers, models, or `/billing/webhooks/stripe` (`billing-stripe`
  Phase 3).
- Expo push delivery — that adapter **polls receipts**; it does not need inbound HTTP
  despite the seed blurb.
- Outbound Slack / Google Chat / Zoom notifiers (already shipped).
- GitHub / CircleCI CI webhooks, Expo API routes, or a job queue (`job-queues`).
- Default-on example Stripe endpoint or a framework-global `WEBHOOK_SECRET`.
- SDK / RTK hooks for webhook POSTs (providers call the API, not the app UI).

## Decisions

| Question | Decision |
|----------|----------|
| Package | **`@terreno/api`**, class `WebhooksApp` implementing `TerrenoPlugin`. Same home as notifiers and rate limiting. No new workspace package. |
| Registration | Consumer-owned paths. `webhooks.route({path, verify, eventId, handler})` then `app.register(webhooks)`. Billing stays at `POST /billing/webhooks/stripe`. |
| Comms routes | **In this IP**, in `@terreno/comms`. `CommsApp` takes a `WebhooksApp` and registers Twilio + SendGrid routes when those adapters are the configured `sms` / `mail` providers. Mapping tables stay the adapter IPs' contract. |
| Raw body | Stash `Buffer` on the request during parse (`express.json` / `urlencoded` `verify`). Never re-serialize `req.body` for HMAC (today's auth-doc snippet is wrong). |
| Content types | JSON (Stripe, SendGrid) and `application/x-www-form-urlencoded` (Twilio). Other types via an explicit `parser: "raw"` route option. |
| Verifiers | Built-in: generic HMAC, Stripe `Stripe-Signature`, Twilio request validator, SendGrid Event Webhook ECDSA. Custom `verify(req) => boolean \| Promise<boolean>`. |
| Secrets | Per-route. Framework does **not** read `WEBHOOK_SECRET`. That env stays optional for the example HMAC demo only. |
| Auth | No JWT / Better Auth session. Missing or invalid signature → `APIError` 401 `code: "webhook-signature-invalid"`. Missing raw body → 400. |
| Idempotency | Optional store. Unique claim on `(source, eventId)` **before** `handler`; duplicate → 200 `{received: true, duplicate: true}` without calling `handler`; handler throw deletes the claim so the provider can retry. |
| Stores | `memory` (tests / single process) \| `mongo` (`webhookReceipts`, TTL default 7 days). No Redis in this slice. |
| Replay window | Stripe verifier: 300s timestamp skew (Stripe default). Generic HMAC: optional timestamp header + skew. Twilio: no timestamp; rely on MessageSid claim. |
| Dispatch | Await `handler` then 200 `{received: true}`. No 200-before-work. Slow work stays in a later `job-queues` IP. |
| Rate limit | Do **not** skip webhook paths. Unsigned floods still consume the `api` IP bucket. |
| OpenAPI | Do not emit webhook POSTs into `/openapi.json` (no generated SDK hooks). |
| Compare | `crypto.timingSafeEqual` on equal-length buffers; length mismatch is invalid. |
| Logging | `createScopedLogger` prefix `[Webhook]` + labels `source`, `eventId`. Never log secrets, raw signatures, or full payloads. |

## Architecture

```
TerrenoApp
  json + urlencoded parsers stash req.rawBody
  …
  WebhooksApp.register(app)
    POST {path}  →  parse already done
                 →  verify(req) using req.rawBody
                 →  eventId(req)
                 →  claim (source, eventId)
                 →  handler({rawBody, body, headers, eventId})
                 →  200 or 500 (release claim)
```

```typescript
const webhooks = new WebhooksApp({idempotency: {store: "mongo"}});

webhooks.route({
  path: "/billing/webhooks/stripe",
  source: "stripe",
  parser: "json",
  verify: stripeSignature({secret: process.env.STRIPE_WEBHOOK_SECRET!}),
  eventId: (req) => String((req.body as {id?: string})?.id ?? ""),
  handler: async ({body}) => { /* billing IP */ },
});

new TerrenoApp({userModel: User}).register(webhooks).start();
```

### Comms registration

```typescript
const webhooks = new WebhooksApp({idempotency: {store: "mongo"}});

new TerrenoApp({userModel: User})
  .register(webhooks)
  .register(
    new CommsApp({
      mail: new SendGridMailProvider(),
      sms: new TwilioSmsProvider(),
      webhooks,
      webhookPublicUrl: process.env.PUBLIC_API_URL, // Twilio signature URL
    })
  )
  .start();
```

`CommsApp` calls `webhooks.route` during `register` when `options.webhooks` is set:

| When | Path | Verifier | `eventId` |
|------|------|----------|-----------|
| `sms` is `TwilioSmsProvider` | `{basePath}/webhooks/twilio/status` | `twilioSignature` | `MessageSid` |
| `sms` is `TwilioSmsProvider` | `{basePath}/webhooks/twilio/inbound` | `twilioSignature` | `SmsSid` + inbound `Body` keyword |
| `mail` is `SendGridMailProvider` | `{basePath}/webhooks/sendgrid` | `sendgridEventSignature` | per-event `sg_event_id` (batch) |

Default `basePath` is `/comms`. Omit `webhooks` → no inbound routes (send path unchanged).
Missing Twilio auth token or SendGrid verification key → skip that provider's routes and
`logger.error` (do not crash boot).

SendGrid posts an **array** of events. The HTTP request may skip a single `eventId`; the
handler calls public `webhooks.claim({source: "sendgrid", eventId})` per `sg_event_id`,
maps each event per the SendGrid adapter table, then `getCommsService().recordDeliveryEvent`
/ `recordOptOut`. Correlate mail rows by `sg_message_id` prefix vs stored `x-message-id`.

Twilio status mapping and STOP/START opt-outs follow
[comms-adapter-twilio-sms](comms-adapter-twilio-sms.md). When webhooks are registered,
`TwilioSmsProvider` `statusCallbackUrl` defaults to
`${webhookPublicUrl}{basePath}/webhooks/twilio/status` so sends attach the callback.

Stripe remains a how-to example only in this slice.

`WebhooksApp` must run its capture setup **before** `express.json`. Plugins currently
mount after JSON, so `WebhooksApp` also implements an early hook: `TerrenoApp.build()`
calls `plugin.captureRawBody?.(app)` (or equivalent) before JSON, then `register` for
routes. If no webhook plugin is registered, parser behavior stays as today except a
harmless `rawBody` Buffer on JSON/urlencoded requests (document the extra field).

Prefer attaching `rawBody` on every JSON parse via the existing `verify` callback so
consumers that register late still verify correctly. Add `express.urlencoded` next to
JSON (auth already mounts urlencoded later; consolidating is allowed if tests stay green).

### Verifier helpers (no vendor SDKs required)

| Helper | Input | Algorithm |
|--------|--------|-----------|
| `hmacSignature({secret, header, encoding?, algorithm?, timestampHeader?})` | Header vs HMAC of `rawBody`, or `${timestamp}.${rawBody}` when `timestampHeader` is set | Default SHA-256 hex; optional skew (300s) |
| `stripeSignature({secret, toleranceSec?})` | `Stripe-Signature` `t=` / `v1=` | HMAC-SHA256 of `${t}.${rawBody}` |
| `twilioSignature({authToken, url?})` | `X-Twilio-Signature`; URL + sorted POST params | HMAC-SHA1 base64 (Twilio validator) |
| `sendgridEventSignature({publicKey, toleranceSec?})` | `X-Twilio-Email-Event-Webhook-Signature` + timestamp | ECDSA P-256 over `${timestamp}${rawBody}`; default 300s skew |

`url` for Twilio defaults to the public URL the provider was given (`X-Forwarded-Proto` /
`Host` + original URL only when `trust proxy` is on — same rule as rate limiting). Apps
behind Cloud Run should pass the configured callback URL explicitly.

### Idempotency store

```
claim({source, eventId}) → "claimed" | "duplicate"
release({source, eventId})  // handler failure only
```

`WebhooksApp.claim` / `release` are public so a batch handler (SendGrid) can claim each
nested event id. HTTP-level `eventId` remains optional.

Mongo collection `webhookReceipts`: `source` (string), `eventId` (string), `created`
(date). Unique compound index `(source, eventId)`. TTL on `created`. Field `description`s
if it is a Mongoose model (`mongoose-schema-safety`). Not a public `modelRouter` model.

Routes with empty `eventId` skip the store and always run `handler` (log a warning).
Billing may keep `BillingEvent.stripeEventId` as a second, domain-level unique key;
the framework claim still runs so unsigned retries never double-dispatch if billing is slow.

## Models

Optional internal **WebhookReceipt** only when `idempotency.store === "mongo"`. Five-type
pattern, `createdUpdatedPlugin` optional; TTL index is the retention mechanism.
`isDeletedPlugin` is unnecessary (rows expire).

## APIs

No framework-fixed path. Contract per registered route:

| Status | Body / error | When |
|--------|----------------|------|
| 200 | `{received: true}` | Handler succeeded |
| 200 | `{received: true, duplicate: true}` | Event id already claimed |
| 400 | `webhook-body-missing` | No `rawBody` |
| 401 | `webhook-signature-invalid` | Verify failed or missing header |
| 500 | existing `APIError` / `apiErrorMiddleware` | Handler threw (claim released) |

Anonymous. Not listed in OpenAPI.

Comms (when `webhooks` is passed and the adapter is configured):

| Method | Path | Notes |
|--------|------|--------|
| POST | `/comms/webhooks/twilio/status` | Form-urlencoded; Twilio signature |
| POST | `/comms/webhooks/twilio/inbound` | Form-urlencoded; STOP/START → `OptOutEvent` |
| POST | `/comms/webhooks/sendgrid` | JSON array; ECDSA; per-event claim |

## Notifications

Comms webhook handlers update `CommsMessage` via `recordDeliveryEvent` / `recordOptOut`.
A throwing `recordDeliveryEvent` (save failure) releases the claim so the provider can retry.

## UI

None. example-backend:

- HMAC demo `POST /webhooks/example` when `WEBHOOK_SECRET` is set.
- Pass the same `WebhooksApp` into `CommsApp` so Twilio/SendGrid routes exist whenever
  those adapters are already env-registered. Set `PUBLIC_API_URL` (or
  `COMMS_WEBHOOK_PUBLIC_URL`) for Twilio signatures on Cloud Run.

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/how-to/inbound-webhooks.md` | **New.** Register a route, raw body, verifiers, idempotency, Cloud Run URL, do not stringify `req.body`. |
| `docs/how-to/README.md` | Link the how-to. |
| `docs/reference/api.md` | `WebhooksApp` under Webhooks & Notifications; contrast outbound notifiers. |
| `docs/explanation/authentication.md` | Replace HMAC-on-`JSON.stringify(req.body)` with `WebhooksApp`. |
| `docs/reference/environment-variables.md` | `WEBHOOK_SECRET` is example-demo only; `SENDGRID_WEBHOOK_VERIFICATION_KEY`, `PUBLIC_API_URL` / `COMMS_WEBHOOK_PUBLIC_URL`. |
| `docs/reference/comms.md` | Twilio + SendGrid webhook paths, mapping, `CommsApp({webhooks})`. |
| `docs/explanation/roadmap-seed-issues.md` | IP + task GitHub URLs; `IP=inbound-webhooks`. |
| `.rulesync/skills/terreno-backend-api/references/custom-routes.md` | Replace hand-rolled Stripe stub with `WebhooksApp.route`. |
| `.rulesync/rules/api/00-api.mdc` | One paragraph on inbound webhooks. |
| `changelog/unreleased/inbound-webhooks.md` | Added. |
| `bun run rules` / `skills:sync` | After rulesync edits. |

## Testing

Bun + supertest against `TerrenoApp.build()`, `@terreno/test` Mongo. Do not mock
`@terreno/api`. Use `backend-test-env` if tests set secrets.

Must cover:

- Valid HMAC 200 and handler called once.
- Tampered body / missing header 401, handler not called.
- `JSON.stringify(req.body)` HMAC does **not** verify (proves raw capture).
- Same `eventId` twice: first 200, second 200 `duplicate: true`, handler once.
- Handler throw: 500, retry succeeds (claim released).
- Stripe fixture header (known secret + payload + timestamp inside/outside window).
- Twilio form-urlencoded body verifies; JSON body on that route 401.
- SendGrid ECDSA fixture (generated keypair in test).
- OpenAPI document does not list the webhook path.
- Default app with no `WebhooksApp` still parses JSON as today.
- Twilio signed status fixture updates `CommsMessage.status`; unsigned 401.
- Twilio STOP inbound fires `onOptOut` with `reason: "sms-stop"`.
- SendGrid signed `delivered` / `bounce` / `spamreport` fixtures map per the adapter
  table; unsigned 401; duplicate `sg_event_id` is a no-op.

## Phases

1. **Tracer:** raw body + `WebhooksApp` + HMAC + memory idempotency + example route.
2. **Provider verifiers + Mongo store:** Stripe, Twilio, SendGrid helpers; mongo receipts.
3. **Comms routes:** Twilio status + inbound, SendGrid Event Webhook, example-backend wiring.
4. **Docs + seed + agent skill:** Diátaxis, changelog, rulesync, dependent-IP links.

## Feature Flags & Migrations

New optional collection only. No user data migration. No RTK flag.

## Activity Log & User Updates

`logger` / scoped webhook logger. No activity-log product surface.

## Not Included / Future Work

- Redis receipt store.
- 200-then-queue dispatch (`job-queues`).
- GitHub App / CircleCI inbound (CI IP).
- Expo push HTTP (not required).
- Stripe billing webhook (`billing-stripe` Phase 3).

## Files to Create / Modify

- `api/src/webhooks/` — `webhooksApp.ts`, `rawBody.ts`, `verifiers/*.ts`, `idempotency/*.ts`, tests
- `api/src/terrenoApp.ts` — early raw-body capture; plugin hook
- `api/src/index.ts` — exports
- `comms/src/commsApp.ts` — `webhooks` / `webhookPublicUrl` options
- `comms/src/adapters/twilioSms.ts` (+ webhook helper) — status + inbound routes
- `comms/src/adapters/sendgrid.ts` (+ webhook helper) — Event Webhook route
- `example-backend/src/server.ts` — HMAC demo + pass `WebhooksApp` into `CommsApp`
- Docs, rulesync, changelog as in the table
- Adapter task lists: Phase 2 owned here
- `docs/implementationPlans/billing-stripe.md` — Depends on this IP (not “pending”)

## Task List

See [docs/tasks/inbound-webhooks.md](../tasks/inbound-webhooks.md).

## Acceptance Criteria

- [ ] An app can register `POST /webhooks/example` with HMAC verification; a signed
      request returns 200 and runs the handler; an unsigned or tampered request returns
      401 and does not run it. Verified by bun tests in `api/src/webhooks/`.
- [ ] Signature verification uses the raw request bytes, not `JSON.stringify(req.body)`.
      Verified by a test that would pass the old auth-doc snippet and fails here.
- [ ] Replaying the same `(source, eventId)` is a 200 no-op. Verified by bun tests
      (memory and mongo stores).
- [ ] Built-in Stripe, Twilio, and SendGrid verifiers accept a fixture and reject a
      mutated payload. Verified by bun tests with no live network.
- [ ] Webhook paths are absent from `/openapi.json`. Verified by bun test against
      `TerrenoApp.build()`.
- [ ] How-to + reference + auth explanation match the shipped API. Verified by reading
      those pages in Roast; `bun run website:build` in the docs task.
- [ ] `billing-stripe` can call `webhooks.route` without forking parsers. Verified by a
      compile-checked Stripe example in the how-to (handlers stay in that IP).
- [ ] With `CommsApp({webhooks, sms: TwilioSmsProvider, mail: SendGridMailProvider})`,
      signed Twilio and SendGrid fixtures update `CommsMessage` / fire `onOptOut`;
      unsigned requests are 401. Verified by bun tests in `comms/`.
