# Implementation Plan: Comms adapter — Twilio SMS

**Status:** In progress — Phase 1 send path shipped; Phase 2 (status callbacks, STOP/START opt-out) open
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1020
**Priority:** Medium
**Effort:** Small batch
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [comms-abstraction](comms-abstraction.md); inbound-webhooks (Phase 2 only)
**RTK deprecation flag:** None — backend only

## Goal

Implement `SmsProvider` on Twilio Programmable Messaging so Terreno apps can send
transactional SMS (OTP fallback, alerts, invitation nudges) through the `@terreno/comms`
facade with delivery logging.

## Non-Goals

- OTP verification (that is `comms-adapter-twilio-verify`, on Twilio Verify).
- Push via Twilio (dropped by decision D5 — Expo push is the push adapter).
- Bulk/campaign messaging, MMS/RCS.
- Phone-number provisioning automation.

## Decisions

| Question | Decision |
|----------|----------|
| SDK | `twilio` as optional peer, subpath `@terreno/comms/adapters/twilioSms` |
| Sender config | Prefer `TWILIO_MESSAGING_SERVICE_SID`; fall back to `TWILIO_FROM_NUMBER`; constructor options override env |
| Number validation | Validate/normalize to E.164 with `libphonenumber-js` (already in catalog) before hitting the API |
| Delivery status | Phase 2: status callback endpoint via the inbound-webhooks framework mapping Twilio statuses to `DeliveryEvent`s |
| Secrets | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` via env or the existing secret-provider layer |
| Error classification | Adapter owns a Twilio error-code → `errorClass` map (table below) so the facade retries only transient failures and the admin dashboard gates manual retries correctly |
| SDK failure handling | Twilio SDK calls wrapped with `withApiErrorHandling` from `@terreno/api` (per [call-external-apis](../how-to/call-external-apis.md)) — the SDK owns transport, the wrapper standardizes logging/normalization |
| Opt-outs | Phase 2: inbound STOP/START (and 21610 send failures) surface as `OptOutEvent` → the consumer's `onOptOut` hook; enforcement stays consumer-side via `beforeSend` (Twilio blocks opted-out sends itself) |
| Admin dashboard support | Every `CommsMessage` row stores the Twilio error code/class and a `metadata.consoleUrl` deep link to the message in the Twilio console for log digging |

## Architecture

```typescript
// @terreno/comms/adapters/twilioSms
export class TwilioSmsProvider implements SmsProvider {
  readonly id = "twilio";
  constructor(options?: {
    accountSid?: string;      // default env TWILIO_ACCOUNT_SID
    authToken?: string;       // default env TWILIO_AUTH_TOKEN
    messagingServiceSid?: string;
    fromNumber?: string;
    statusCallbackUrl?: string; // Phase 2
  });
  sendSms(message: {to: string; body: string}): Promise<SendResult>;
}
```

Errors map Twilio exception codes to `SendResult.error`/`errorCode`/`errorClass`, with
the full Twilio error payload kept in `CommsMessage.metadata` for triage. Invalid
destination numbers return a permanent `SendResult` (`errorCode: twilio-invalid-destination`)
before any API call so the facade does not retry.

### Error classification

The adapter classifies Twilio error codes into the abstraction's `errorClass` taxonomy.
Permanent failures must never be auto-retried (retrying an unsubscribed number is a
compliance problem, not a delivery problem); transient failures are retried once inline
by the facade and stay manually retryable from the admin dashboard.

| Twilio code(s) | Meaning | `errorClass` |
|---|---|---|
| 21211, 21214, 21217 | Invalid / unroutable destination number | `permanent` |
| 21408 | SMS not enabled for destination region | `permanent` |
| 21610 | Recipient has opted out (STOP) | `permanent` (also emits `OptOutEvent`) |
| 30003, 30005, 30006 | Unreachable handset / unknown device / landline | `permanent` |
| 30007 | Carrier content filtering | `permanent` (surface loudly — usually a sender-reputation problem) |
| 20429, 429 responses | Rate limited / concurrency limit | `transient` |
| 30001, 30002 | Queue overflow / account suspended-ish delivery interruption | `transient` |
| 5xx / network errors | Twilio-side or transport failure | `transient` |
| 20003, 20404 (auth/SID misconfig) | Bad credentials or missing resource | `config` |

Unknown codes default to `transient` (safe for one retry) and are logged with the raw
code so the map can be extended. `config` failures additionally `logger.error` at send
time — they mean the app is misconfigured, not that the message was undeliverable.

### Status callback mapping (Phase 2)

| Twilio `MessageStatus` | `DeliveryEvent.status` | `CommsMessage.status` |
|---|---|---|
| `queued`, `accepted`, `sending`, `sent` | — (no event; already `sent`) | `sent` |
| `delivered` | `delivered` | `delivered` |
| `undelivered`, `failed` | `failed` (+ `errorCode` from `ErrorCode` param) | `failed` |

Inbound `STOP`/`START` keyword webhooks (same inbound-webhooks registration) map to
`OptOutEvent {channel: "sms", reason: "sms-stop"}` / opt-in, feeding the consumer's
`onOptOut` hook and `CommsMessage.metadata` on subsequent 21610 failures.

## Models / APIs / Notifications / UI

None new — Phase 2 adds one webhook route via the inbound-webhooks framework.

## Phases

1. **Send path:** provider, config resolution, E.164 validation, error-code
   classification map, `withApiErrorHandling` wrapping, console deep-link metadata, tests
   with mocked Twilio client; example-backend env-gated registration; docs.
2. **Delivery callbacks + opt-outs** *(owned and shipped by
   [inbound-webhooks](inbound-webhooks.md) Task 3.2)*: status callback route with Twilio
   signature verification, statuses → `DeliveryEvent` → `CommsMessage.status` updates
   (with `errorCode`), STOP/START keyword handling → `OptOutEvent` → `onOptOut`. Do not
   Pick those tasks on this adapter IP.

## Feature Flags & Migrations

None.

## Activity Log & User Updates

All sends logged to `CommsMessage` with provider `twilio`.

## Not Included / Future Work

- Inbound SMS (replies) handling beyond STOP/START keywords.
- Alphanumeric sender IDs, international compliance tooling.
- Terreno-managed opt-out suppression list — the adapter emits `OptOutEvent`; storing and
  enforcing preferences is consumer-side (`beforeSend`) until `notification-center` lands.

## Files to Create / Modify

- `comms/src/adapters/twilioSms.ts` + tests
- `comms/package.json` — optional peer `twilio`
- `example-backend/src/server.ts` — env-gated registration
- `docs/reference/comms.md`, `docs/reference/environment-variables.md`

## Task List

See [docs/tasks/comms-adapter-twilio-sms.md](../tasks/comms-adapter-twilio-sms.md).

## Acceptance Criteria

- [ ] `sendSms` delivers via messaging service or from-number config, preferring the
      messaging service when both are present.
- [ ] A non-E.164 destination fails with a 400 `APIError` before any Twilio call.
- [ ] Twilio API errors produce `accepted: false` results with `errorCode` and a correct
      `errorClass` per the classification table; the full Twilio error payload lands in
      `CommsMessage.metadata`; nothing throws through the facade.
- [ ] Permanent-class failures (21610, 30003, …) are never retried inline and appear as
      non-retryable in the admin dashboard; transient-class failures retry once and stay
      manually retryable.
- [ ] Each send stores `metadata.consoleUrl` linking the message SID to the Twilio
      console.
- [ ] Consumer `onError` fires with the classified `SendResult` on every failed send
      (mocked-client test).
- [ ] Apps not using the adapter do not install the `twilio` SDK.
- [ ] (Phase 2) Status callbacks flip `CommsMessage.status` to `delivered`/`failed` (with
      `errorCode`) under verified Twilio signatures.
- [ ] (Phase 2) An inbound STOP fires `onOptOut` with `reason: "sms-stop"`; a subsequent
      send to that number records 21610 as `permanent`.
