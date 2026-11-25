# Tasks: Comms adapter — Twilio Verify (OTP)

IP: [comms-adapter-twilio-verify](../implementationPlans/comms-adapter-twilio-verify.md)

- [x] **Task 1**: `TwilioVerifyProvider` start/check
  - Description: provider per IP with config resolution and status mapping
  - Files: `comms/src/adapters/twilioVerify.ts`
  - Depends on: comms-abstraction Phase 1
  - Acceptance: mocked-client tests for approved/pending/expired/max-attempts
- [x] **Task 2**: Redacted logging + error classification
  - Description: `CommsMessage` rows with channel `verification`, fully redacted destination, no codes, and verification channel metadata on start; `errorCode`/`errorClass` mapping (rate-limit transient, expired/max-attempts permanent, bad SID config); rows flagged non-retryable; `onError` fires on failures
  - Files: `comms/src/adapters/twilioVerify.ts`
  - Depends on: Task 1
  - Acceptance: log assertion tests prove no code/full destination in any row; failure fixtures assert class + onError
- [x] **Task 3**: Registration + docs
  - Description: env-gated example-backend registration; fail-fast on missing service SID; reference + env docs
  - Files: `example-backend/src/server.ts`, `docs/reference/comms.md`, `docs/reference/environment-variables.md`
  - Depends on: Task 1
  - Acceptance: boot without config skips registration; with partial config throws at startup
