# Implementation Plan: Comms adapter — transactional email (SendGrid)

**Status:** In progress — Phase 1 send path implemented; Phase 2 gated on inbound-webhooks
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1022
**Priority:** High
**Effort:** Small batch
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [comms-abstraction](comms-abstraction.md); inbound-webhooks (Phase 2 only)
**RTK deprecation flag:** None — backend only

## Goal

Implement `MailProvider` on Twilio SendGrid (decision D2 — first mail adapter, sharing the
Twilio account story with the SMS and Verify adapters) so `sendMail` delivers real
transactional email. This unblocks `password-reset-and-email-verification` and
`invitations-and-seats`.

## Non-Goals

- Other mail providers (Resend/SES/SMTP — items when demand appears).
- Marketing campaigns, contact lists, SendGrid dynamic template management.
- Inbound email parsing.

## Decisions

| Question | Decision |
|----------|----------|
| SDK | `@sendgrid/mail` as optional peer, subpath `@terreno/comms/adapters/sendgrid` |
| Auth | `SENDGRID_API_KEY` env or constructor option; fail fast at registration when missing |
| From address | Constructor `fromEmail`/`fromName` falling back to `CommsApp.defaultFrom`; sender verification is a documented SendGrid prerequisite, not automated |
| Templates | Terreno-side rendering (`templates.ts` from the abstraction) sent as `text`/`html`; SendGrid dynamic templates supported pass-through via `templateId` + `dynamicTemplateData` but not required |
| Sandbox | SendGrid `mail_settings.sandbox_mode` toggle for CI/e2e so tests never send |
| Delivery events | Phase 2: SendGrid Event Webhook (delivered/deferred/bounce/dropped/spamreport/unsubscribe/open) with ECDSA signature verification via the inbound-webhooks framework, mapped to `DeliveryEvent`s / `OptOutEvent`s |
| Error classification | Adapter owns the HTTP-status + event-type → `errorClass` map (table below); 429/5xx are `transient`, other 4xx `permanent`, 401/403 `config` |
| Suppression / opt-outs | Bounces, spam reports, and unsubscribes emit `OptOutEvent` → consumer `onOptOut`. SendGrid maintains its own suppression lists; a send to a suppressed address comes back as a `dropped` event with the suppression reason, classified `permanent` |
| Admin dashboard support | Every `CommsMessage` row stores `errorCode`/`errorClass`, the `x-message-id`, and a `metadata.consoleUrl` deep link to SendGrid Email Activity for log digging |

## Architecture

```typescript
// @terreno/comms/adapters/sendgrid
export class SendGridMailProvider implements MailProvider {
  readonly id = "sendgrid";
  constructor(options?: {
    apiKey?: string;          // default env SENDGRID_API_KEY
    fromEmail?: string;
    fromName?: string;
    sandboxMode?: boolean;    // default true when NODE_ENV === "test"
  });
  sendMail(message: MailMessage): Promise<SendResult>;
}
```

Error mapping: SendGrid 4xx (bad address, unverified sender) → `accepted: false` with the
response body's first error message in `SendResult.error` and full body in
`CommsMessage.metadata`; 429/5xx classified `transient` and retried once by the core
facade. The provider never throws through `sendMail`.

### Error classification

Send-time failures classify by HTTP status; post-acceptance failures arrive as events
(Phase 2) and reclassify the `CommsMessage`.

| Signal | Meaning | `errorCode` | `errorClass` |
|---|---|---|---|
| 400 (bad address, missing field), 413 | Request is wrong | `sendgrid-<status>` + first body error | `permanent` |
| 401, 403 (bad key, unverified sender) | App misconfiguration | `sendgrid-<status>` | `config` (also `logger.error` at send time) |
| 429 | Rate limited | `sendgrid-429` | `transient` |
| 5xx / network errors | SendGrid-side or transport failure | `sendgrid-<status>` | `transient` |
| Event: `bounce` (hard) | Mailbox permanently rejects | `bounce` + reason | `permanent` |
| Event: `bounce` (soft) / `deferred` | Temporary mailbox/receiver issue | `deferred` | `transient` |
| Event: `dropped` | SendGrid suppressed (prior bounce, spam report, unsubscribe, invalid) | `dropped` + reason | `permanent` |
| Event: `spamreport`, `unsubscribe`, `group_unsubscribe` | Recipient opted out | event type | `permanent` (also emits `OptOutEvent`) |

Permanent-class failures are never auto-retried and show as non-retryable in the admin
dashboard with the reason (retrying a suppressed or unsubscribed address damages sender
reputation); transient-class failures retry once inline and stay manually retryable.

### Event webhook mapping (Phase 2)

| SendGrid event | `DeliveryEvent.status` | `CommsMessage.status` |
|---|---|---|
| `processed` | — | `sent` (unchanged) |
| `delivered` | `delivered` | `delivered` |
| `deferred` | — (attempt noted in metadata) | `sent` (SendGrid keeps retrying) |
| `bounce`, `dropped` | `bounced` / `failed` (+ reason as `errorCode`) | `bounced` / `failed` |
| `open` | `opened` | unchanged (recorded in metadata) |
| `spamreport`, `unsubscribe`, `group_unsubscribe` | — | unchanged; emits `OptOutEvent` → `onOptOut` |

Events correlate to rows via the `x-message-id` response header captured at send time
(SendGrid appends per-recipient suffixes; match on the prefix).

## Models / APIs / Notifications / UI

None new. Phase 2 adds one webhook route via the inbound-webhooks framework.

## Phases

1. **Send path:** provider, config resolution, sandbox mode, error classification,
   `x-message-id` capture + Email Activity deep link, mocked-client tests;
   example-backend env-gated registration; docs (including the sender-verification
   prerequisite checklist).
2. **Delivery events + opt-outs** *(owned and shipped by
   [inbound-webhooks](inbound-webhooks.md) Task 3.3)*: Event Webhook route with ECDSA
   signature verification; event mapping per the table → `DeliveryEvent`/`OptOutEvent` →
   `CommsMessage.status` + consumer hooks. Do not Pick those tasks on this adapter IP.

## Feature Flags & Migrations

None.

## Activity Log & User Updates

All sends logged to `CommsMessage` with provider `sendgrid`.

## Not Included / Future Work

- Suppression-list *management* (viewing/clearing SendGrid suppressions from admin) — the
  adapter only reports suppression outcomes; a management surface can extend the
  [comms-admin-dashboard](comms-admin-dashboard.md) later.
- Unsubscribe-group configuration.
- Batch sending beyond the multiple-recipient `to` array.

## Files to Create / Modify

- `comms/src/adapters/sendgrid.ts` + tests
- `comms/package.json` — optional peer `@sendgrid/mail`
- `example-backend/src/server.ts` — env-gated registration
- `docs/reference/comms.md`, `docs/reference/environment-variables.md`

## Task List

See [docs/tasks/comms-adapter-sendgrid.md](../tasks/comms-adapter-sendgrid.md).

## Acceptance Criteria

- [x] `sendMail` delivers text/html mail with from-address fallback chain (provider option
      → `CommsApp.defaultFrom`), and passes `templateId`/`dynamicTemplateData` through when
      given.
- [x] Sandbox mode is on by default under test and produces accepted results without real
      sends.
- [x] SendGrid errors surface as `accepted: false` with the SendGrid error message and a
      correct `errorCode`/`errorClass` per the classification table; nothing throws
      through the facade.
- [x] 401/403 classify as `config` and `logger.error` at send time; 429/5xx classify as
      `transient` and retry once; other 4xx are `permanent` and never retried.
- [x] Each accepted send captures the `x-message-id` and stores a `metadata.consoleUrl`
      Email Activity deep link.
- [x] Consumer `onError` fires with the classified `SendResult` on every failed send
      (mocked-client test).
- [x] Missing API key fails fast at `CommsApp` registration with a clear error.
- [x] Apps not using the adapter do not install `@sendgrid/mail`.
- [ ] (Phase 2) Event webhook updates `CommsMessage.status` per the mapping table only
      for signature-verified payloads; bounce/dropped reasons land as `errorCode`.
- [ ] (Phase 2) `spamreport`/`unsubscribe` events fire `onOptOut`; later sends to the
      suppressed address record `dropped` as `permanent`.
