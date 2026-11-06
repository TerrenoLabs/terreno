# Tasks: Comms adapter — Twilio SMS

IP: [comms-adapter-twilio-sms](../implementationPlans/comms-adapter-twilio-sms.md)

## Phase 1 — Send path

- [x] **Task 1.1**: `TwilioSmsProvider` with config resolution
  - Description: constructor/env config, messaging-service-first sender selection
  - Files: `comms/src/adapters/twilioSms.ts`
  - Depends on: comms-abstraction Phase 1
  - Acceptance: mocked-client tests cover both sender configs
- [x] **Task 1.2**: E.164 validation + error classification
  - Description: `libphonenumber-js` normalization; Twilio error-code → `errorCode`/`errorClass` map per the IP table (unknown codes → `transient`); full error payload into `CommsMessage.metadata`; Twilio SDK calls wrapped with `withApiErrorHandling`
  - Files: `comms/src/adapters/twilioSms.ts`
  - Depends on: 1.1
  - Acceptance: invalid number → permanent `SendResult` before API call; fixtures for at least one code per class (e.g. 21610 permanent, 20429 transient, 20003 config) assert `errorClass`; permanent failures skip the inline retry
- [x] **Task 1.3**: Dashboard metadata + hooks coverage
  - Description: `metadata.consoleUrl` deep link per message SID; `onError` fires with the classified `SendResult`
  - Files: `comms/src/adapters/twilioSms.ts` + tests
  - Depends on: 1.2
  - Acceptance: failed-send test asserts consoleUrl and onError invocation
- [x] **Task 1.4**: Peer dep + example-backend registration + docs
  - Description: optional peer `twilio`; env-gated registration; reference + env-var docs
  - Files: `comms/package.json`, `example-backend/src/server.ts`, `docs/reference/comms.md`, `docs/reference/environment-variables.md`
  - Depends on: 1.1
  - Acceptance: compile + boot without twilio installed when unconfigured

## Phase 2 — Delivery callbacks + opt-outs (owned by inbound-webhooks)

HTTP routes and mapping land in [inbound-webhooks](../implementationPlans/inbound-webhooks.md)
Tasks 3.2–3.3. The tables in the Twilio SMS IP remain the contract. Do not Pick these on
this adapter branch.

- [ ] **Task 2.1**: Status callback route
  - Description: webhook endpoint with Twilio signature verification via inbound-webhooks framework; status mapping per IP table incl. `ErrorCode` propagation
  - Files: `comms/src/adapters/twilioSms.ts`, webhook registration
  - Depends on: inbound-webhooks Task 3.2
  - Acceptance: signed payload updates `CommsMessage.status` (+ `errorCode` on failure); unsigned rejected 401
- [ ] **Task 2.2**: STOP/START opt-out handling
  - Description: inbound keyword webhook → `OptOutEvent` → consumer `onOptOut`; opt-in (START) emitted symmetrically
  - Files: `comms/src/adapters/twilioSms.ts`, webhook registration + tests
  - Depends on: inbound-webhooks Task 3.2
  - Acceptance: STOP fixture fires `onOptOut` with `reason: "sms-stop"`; 21610 on later sends classified `permanent`
