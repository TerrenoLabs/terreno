# Tasks: Comms adapter — transactional email (SendGrid)

IP: [comms-adapter-sendgrid](../implementationPlans/comms-adapter-sendgrid.md)

## Phase 1 — Send path

- [x] **Task 1.1**: `SendGridMailProvider` with config + sandbox mode
  - Description: constructor/env config, from-address fallback chain, sandbox default under test
  - Files: `comms/src/adapters/sendgrid.ts`
  - Depends on: comms-abstraction Phase 1
  - Acceptance: mocked-client tests for text/html/template sends
- [x] **Task 1.2**: Error classification
  - Description: HTTP status → `errorCode`/`errorClass` per the IP table (400 permanent, 401/403 config, 429/5xx transient); full response body into `CommsMessage.metadata`; never throws
  - Files: `comms/src/adapters/sendgrid.ts`
  - Depends on: 1.1
  - Acceptance: unverified-sender (config), bad-address (permanent), and 429 (transient) fixtures assert `errorClass`; permanent skips the inline retry
- [x] **Task 1.3**: Dashboard metadata + hooks coverage
  - Description: capture `x-message-id`; `metadata.consoleUrl` Email Activity deep link; `onError` fires with the classified `SendResult`
  - Files: `comms/src/adapters/sendgrid.ts` + tests
  - Depends on: 1.2
  - Acceptance: accepted-send test asserts message id + consoleUrl; failed-send test asserts onError invocation
- [x] **Task 1.4**: Peer dep + registration + docs
  - Description: optional peer `@sendgrid/mail`; env-gated example-backend registration with fail-fast; reference + env docs incl. sender-verification checklist
  - Files: `comms/package.json`, `example-backend/src/server.ts`, `docs/reference/comms.md`, `docs/reference/environment-variables.md`
  - Depends on: 1.1
  - Acceptance: boot without key skips registration; compile passes without the SDK installed

## Phase 2 — Delivery events + opt-outs (owned by inbound-webhooks)

HTTP routes and mapping land in [inbound-webhooks](../implementationPlans/inbound-webhooks.md)
Task 3.3. The tables in the SendGrid IP remain the contract. Do not Pick these on this
adapter branch.

- [ ] **Task 2.1**: Event Webhook route
  - Description: ECDSA signature verification via inbound-webhooks; event mapping per the IP table → `DeliveryEvent`; `x-message-id` prefix correlation
  - Files: `comms/src/adapters/sendgrid.ts`, webhook registration
  - Depends on: inbound-webhooks Task 3.3
  - Acceptance: signed fixtures per event type update `CommsMessage.status` (+ `errorCode` for bounce/dropped); unsigned rejected 401
- [ ] **Task 2.2**: Opt-out events
  - Description: `spamreport`/`unsubscribe`/`group_unsubscribe` → `OptOutEvent` → consumer `onOptOut`
  - Files: `comms/src/adapters/sendgrid.ts` + tests
  - Depends on: inbound-webhooks Task 3.3
  - Acceptance: spamreport fixture fires `onOptOut`; subsequent `dropped` classified `permanent`
