# Implementation Plan: Comms adapter — Twilio Verify (OTP)

**Status:** Draft
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1021
**Priority:** Medium
**Effort:** Small batch
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [comms-abstraction](comms-abstraction.md)
**RTK deprecation flag:** None — backend only

## Goal

Implement `VerificationProvider` on Twilio Verify so Terreno apps get managed one-time-code
flows (SMS and email channels) without storing, expiring, or rate-limiting codes
themselves. This is the delivery channel the future `mfa-step-up-auth` work builds on, and
it is immediately usable for phone-number verification.

## Non-Goals

- The MFA enrollment/step-up product itself (`mfa-step-up-auth` item).
- TOTP (app-authenticator) support — that is code-local (`otpauth`), not a Verify concern.
- Custom code storage or self-managed rate limiting (Verify owns both).

## Decisions

| Question | Decision |
|----------|----------|
| SDK | `twilio` optional peer (shared with the SMS adapter), subpath `@terreno/comms/adapters/twilioVerify` |
| Service config | `TWILIO_VERIFY_SERVICE_SID` env or constructor option |
| Channels | `sms` and `email` (Verify's email channel requires a configured Verify email integration; documented, not automated) |
| Abuse control | Rely on Verify's built-in rate limits; add Terreno-side per-user attempt caps only when `rate-limiting` IP lands |
| Logging | Start/check attempts logged to `CommsMessage` with channel `verification`, never logging the code |
| Error classification | Verify errors map to the abstraction taxonomy: 20429/429 and 5xx → `transient`; max-attempts, expired, and invalid-destination → `permanent`; missing/invalid service SID → `config` |
| Admin dashboard support | Verification rows appear in the [comms-admin-dashboard](comms-admin-dashboard.md) with `errorCode`/`errorClass` and a `metadata.consoleUrl` deep link to the Verify service logs — but the `verification` channel is **never retryable** from admin (codes expire; the user restarts the flow) |
| Hooks | `onError` fires on failed starts/checks like any other channel; `beforeSend` can gate verification starts (e.g. per-user cool-downs) |

## Architecture

```typescript
// @terreno/comms/adapters/twilioVerify
export class TwilioVerifyProvider implements VerificationProvider {
  readonly id = "twilio-verify";
  constructor(options?: {accountSid?: string; authToken?: string; verifyServiceSid?: string});
  startVerification(options: {to: string; channel: "sms" | "email"}): Promise<SendResult>;
  checkVerification(options: {to: string; code: string}): Promise<{valid: boolean; error?: string}>;
}
```

`checkVerification` maps Verify's `approved` status to `valid: true`; `pending`, `expired`,
and max-attempt states return `valid: false` with reason in the result error, letting
callers throw the appropriate `APIError`.

## Models / APIs / Notifications / UI

None new. Consumer routes (e.g. `POST /auth/verifyPhone`) arrive with the features that
need them; this IP ships the provider plus example-backend registration only.

## Phases

Single phase.

## Feature Flags & Migrations

None.

## Activity Log & User Updates

Verification attempts logged to `CommsMessage` (no codes; destination fully redacted by core,
with the verification channel stored in metadata).

## Not Included / Future Work

- MFA enrollment, recovery codes, biometric step-up (`mfa-step-up-auth`).
- WhatsApp/voice channels.
- Android SMS autofill hash configuration (`react-native-otp-verify`, decision D7).

## Files to Create / Modify

- `comms/src/adapters/twilioVerify.ts` + tests (mocked Twilio client)
- `example-backend/src/server.ts` — env-gated registration
- `docs/reference/comms.md`, `docs/reference/environment-variables.md`

## Task List

See [docs/tasks/comms-adapter-twilio-verify.md](../tasks/comms-adapter-twilio-verify.md).

## Acceptance Criteria

- [ ] `startVerification` creates a Verify verification on the configured service for sms
      and email channels.
- [ ] `checkVerification` returns `valid: true` only for `approved`; expired and
      max-attempt states return `valid: false` with a reason.
- [ ] Failed starts/checks record `errorCode`/`errorClass` per the classification row and
      fire the consumer `onError` hook; verification rows are marked non-retryable for
      the admin dashboard.
- [ ] No OTP code ever appears in logs or `CommsMessage` rows; destinations are redacted.
- [ ] Missing `TWILIO_VERIFY_SERVICE_SID` fails fast at registration with a clear error.
