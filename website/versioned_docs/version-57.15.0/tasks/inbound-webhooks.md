# Tasks: Inbound webhook framework

IP: [inbound-webhooks.md](../implementationPlans/inbound-webhooks.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1172

**Feature profile:** false (full IP)

## Phase 1 — Tracer (raw body, HMAC, memory claim)

- [x] **Task 1.1**: Raw-body capture on TerrenoApp parsers
  - Delivers: JSON (and urlencoded) parse stores `req.rawBody` as a `Buffer`; existing JSON routes still work
  - Files: `api/src/webhooks/rawBody.ts`, `api/src/terrenoApp.ts`, `api/src/webhooks/rawBody.test.ts`
  - Blocked by: none
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: stub one sentence in `docs/reference/api.md` that inbound routes will use `rawBody`
  - Acceptance: bun test — parsed `req.body` matches today; `rawBody` equals the sent bytes; mutating parsed JSON does not change `rawBody`

- [x] **Task 1.2**: `WebhooksApp` + HMAC verifier + memory idempotency
  - Delivers: `new WebhooksApp().route({path, source, verify, eventId, handler})`; `app.register(webhooks)` mounts anonymous POST; valid HMAC 200 once; bad/missing signature 401 `webhook-signature-invalid`; duplicate `eventId` 200 `duplicate: true` without second handler; handler throw 500 then retry succeeds; path not in `/openapi.json`
  - Files: `api/src/webhooks/webhooksApp.ts`, `api/src/webhooks/verifiers/hmac.ts`, `api/src/webhooks/idempotency/memoryStore.ts`, `api/src/webhooks/webhooksApp.test.ts`, `api/src/index.ts`, `api/src/terrenoPlugin.ts` (early capture hook if needed)
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`
  - Docs: stub `WebhooksApp` example in `docs/reference/api.md`
  - Acceptance: bun + supertest cover the Goal tracer in the IP; timing-safe compare; empty `eventId` skips claim and warns; `webhooks.claim` is callable from a handler for nested ids

## Phase 2 — Provider verifiers + Mongo receipts

- [x] **Task 2.1**: Stripe + Twilio + SendGrid verifiers
  - Delivers: `stripeSignature`, `twilioSignature`, `sendgridEventSignature` helpers; Stripe and SendGrid timestamps outside tolerance fail; Twilio form-urlencoded verifies; SendGrid ECDSA with a test keypair
  - Files: `api/src/webhooks/verifiers/stripe.ts`, `twilio.ts`, `sendgrid.ts`, `verifiers/*.test.ts`
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: verifier table in `docs/how-to/inbound-webhooks.md` (create page if 3.1 not started)
  - Acceptance: fixture tests only (no network); mutated payload 401

- [x] **Task 2.2**: Mongo idempotency store
  - Delivers: `idempotency: {store: "mongo", ttlDays?}` uses mongoose connection and `webhookReceipts` unique `(source, eventId)` + TTL; claim-before-handler; release on throw
  - Files: `api/src/webhooks/idempotency/mongoStore.ts`, schema/types if a model is used, tests via `@terreno/test`
  - Blocked by: 1.2
  - Skills: `mongoose-schema-safety`, `backend-test-env`
  - Docs: collection / TTL note on the how-to
  - Acceptance: two sources can share an event id string; TTL index present; no public modelRouter

## Phase 3 — Example HMAC + comms routes

- [x] **Task 3.1**: example-backend HMAC demo
  - Delivers: `POST /webhooks/example` registered only when `WEBHOOK_SECRET` is set; handler logs `[Webhook]` and returns `{received: true}`
  - Files: `example-backend/src/server.ts` (or small `webhooksExample.ts` + test)
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: none (4.1)
  - Acceptance: bun test — unset secret → no route (404); set secret → signed POST 200

- [x] **Task 3.2**: Twilio status + inbound routes on CommsApp
  - Delivers: `CommsApp({webhooks, webhookPublicUrl, sms: TwilioSmsProvider})` mounts `POST {basePath}/webhooks/twilio/status` and `.../inbound`; Twilio verifier; status mapping per comms-adapter-twilio-sms table including `ErrorCode`; STOP/START → `recordOptOut`; `statusCallbackUrl` defaults to the public status URL; skip routes and `logger.error` if auth token missing
  - Files: `comms/src/commsApp.ts`, `comms/src/adapters/twilioSms.ts` (or `comms/src/webhooks/twilio.ts`), tests, `example-backend/src/server.ts` (pass `webhooks` when SMS adapter is on)
  - Blocked by: 2.1
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: paths in `docs/reference/comms.md` (full page in 4.1)
  - Acceptance: bun tests — signed delivered/failed fixtures update `CommsMessage`; unsigned 401; STOP fires `onOptOut` `reason: "sms-stop"`; no `webhooks` option → those paths 404

- [x] **Task 3.3**: SendGrid Event Webhook on CommsApp
  - Delivers: `CommsApp({webhooks, mail: SendGridMailProvider})` mounts `POST {basePath}/webhooks/sendgrid`; ECDSA verifier; per-`sg_event_id` `webhooks.claim`; mapping per comms-adapter-sendgrid table; correlate `sg_message_id` prefix to stored `x-message-id`; `SENDGRID_WEBHOOK_VERIFICATION_KEY` (or constructor `webhookVerificationKey`); skip + `logger.error` if key missing
  - Files: `comms/src/commsApp.ts`, `comms/src/adapters/sendgrid.ts` (or `comms/src/webhooks/sendgrid.ts`), tests, `example-backend/src/server.ts`
  - Blocked by: 2.1
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: path + key in `docs/reference/comms.md` / env table (4.1)
  - Acceptance: bun tests — signed delivered/bounce/spamreport fixtures; unsigned 401; duplicate `sg_event_id` no second `recordDeliveryEvent`; batch of two events both applied

## Phase 4 — Docs and seed

- [x] **Task 4.1**: Diátaxis + changelog + agent docs
  - Delivers: how-to, reference, replace auth HMAC snippet, env table (`SENDGRID_WEBHOOK_VERIFICATION_KEY`, `PUBLIC_API_URL` / `COMMS_WEBHOOK_PUBLIC_URL`), comms webhook section, custom-routes skill, api rule, unreleased changelog, seed IP/task URLs, adapter Phase 2 ownership note, `bun run rules` / `skills:sync` if rulesync changed
  - Files: `docs/how-to/inbound-webhooks.md`, `docs/how-to/README.md`, `docs/reference/api.md`, `docs/reference/comms.md`, `docs/explanation/authentication.md`, `docs/reference/environment-variables.md`, `docs/explanation/roadmap-seed-issues.md`, `docs/implementationPlans/billing-stripe.md`, `docs/implementationPlans/comms-adapter-twilio-sms.md`, `docs/implementationPlans/comms-adapter-sendgrid.md`, `.rulesync/skills/terreno-backend-api/references/custom-routes.md`, `.rulesync/rules/api/00-api.mdc`, `.rulesync/rules/comms/00-comms.md`, `changelog/unreleased/inbound-webhooks.md`
  - Blocked by: 1.2 (content must match 2.x and 3.x)
  - Skills: `update-docs`, `update-agent-docs`
  - Acceptance: a stranger can register HMAC, Twilio, and SendGrid routes from the how-to/comms reference without reading this IP; `bun run website:build`; old `JSON.stringify(req.body)` snippet gone
