# Tasks: Pluggable communications layer (@terreno/comms)

IP: [comms-abstraction](../implementationPlans/comms-abstraction.md)

## Phase 1 — Package + contracts

- [x] **Task 1.1**: Scaffold `@terreno/comms` workspace package
  - Description: `comms/` package with tsconfig/biome/bun test setup mirroring `feature-flags/`; root workspace entry + `comms:*` scripts
  - Files: `comms/package.json`, `comms/tsconfig.json`, `comms/biome.jsonc`, root `package.json`
  - Depends on: none
  - Acceptance: `bun run comms:compile` and `bun run comms:lint` pass
- [x] **Task 1.2**: Finish provider types for remaining contracts
  - Description: Add `cancelled` to `CommsMessageStatus`; expand `CommsHookContext` (`message`, `userId`, `isRetry`, `attempt`, `messageId`); add `OptOutEvent`; add `errorCode`/`errorClass` on `DeliveryEvent`; keep shipped `onRetry(context, result)` and `isPermanentFailure` alias
  - Status: base provider/message/`errorCode`/`errorClass` shipped; listed fields remain
  - Files: `comms/src/types.ts`, `comms/src/index.ts`
  - Depends on: 1.1
  - Acceptance: types compile and are exported; existing SendGrid tests still typecheck against `onRetry(context, result)`
- [x] **Task 1.3**: Console adapters
  - Description: dev adapters for all four channels logging via `logger.info`
  - Files: `comms/src/adapters/console.ts` + tests
  - Depends on: 1.2
  - Acceptance: each adapter returns `accepted: true` and logs
- [x] **Task 1.4**: `CommsMessage` attempt history + dashboard fields
  - Description: add `status: cancelled`, `attempts[]`, `attemptCount`, `lastAttemptAt`, `retriedFromId`/`retriedById`, `templateId`, `payload`, `payloadExpiresAt`; `logSend` creates the first row; `appendAttempt` never throws; `clearExpiredPayloads` unsets expired `payload` only (limit 50)
  - Files: `comms/src/models/commsMessage.ts`, `comms/src/modelTypes.ts` + tests
  - Depends on: 1.2
  - Acceptance: send logging survives a forced model error (logged, not thrown); a second attempt appends without a second row; Mongo TTL index is not used
  - Status: model, `errorCode`/`errorClass`, and non-throwing `logSend` shipped; listed fields remain
- [x] **Task 1.5**: Channel-wide transient retry + no rethrow
  - Description: wrap provider throws as `{accepted: false, errorClass: "transient", errorCode: "provider-throw"}`; retry once on transient for `sendMail`, `sendSms`, `startVerification`; for `sendPushToUser`, retry only tokens whose first result is transient; do not retry `checkVerification`; prune tokens when `errorClass === "permanent"` or `isPermanentFailure === true`
  - Status: mail retry shipped; SMS/push/verification still rethrow; prune is `isPermanentFailure` only
  - Files: `comms/src/commsService.ts` + tests
  - Depends on: 1.2, 1.3, 1.4
  - Acceptance: unit tests cover happy path + unconfigured channel in both env modes; permanent/config failures do not retry; SMS throw returns a `SendResult` instead of rejecting
- [x] **Task 1.6**: Lifecycle hooks + event intake
  - Description: `beforeSend` (mutate/cancel, once before first attempt; throwing beforeSend = no cancel); `onSend`/`onError`/`onRetry` (keep `(context, result)`, set `context.attempt`); `recordDeliveryEvent` / `recordOptOut` invoke `onDeliveryEvent` / `onOptOut` and update the log row by `providerMessageId` when present; wrap every hook
  - Files: `comms/src/commsService.ts`, `comms/src/types.ts` + tests
  - Depends on: 1.5
  - Acceptance: one test per hook (fires with correct context) plus one throwing-hook test per hook; cancelled send has `status: "cancelled"` and zero provider calls
- [x] **Task 1.7**: Payload retention + redaction
  - Description: `retainPayloadDays` (default 30) stores the channel payload after `redactPayload`; `retainPayloadDays: 0` stores nothing; push payload omits tokens; verification start stores `{channel}` only; `clearExpiredPayloads` runs best-effort from `logSend`/`appendAttempt`
  - Files: `comms/src/commsService.ts`, `comms/src/models/commsMessage.ts` + tests
  - Depends on: 1.4, 1.5, 1.6
  - Acceptance: payload stored redacted; expired payload cleared without deleting the row; `retainPayloadDays: 0` stores nothing

## Phase 2 — CommsApp + routes

- [x] **Task 2.1**: `PushToken` model
  - Description: model per IP with unique token upsert semantics
  - Files: `comms/src/models/pushToken.ts` + tests
  - Depends on: 1.1
  - Acceptance: duplicate token registration updates the existing row
- [x] **Task 2.2**: `CommsApp` TerrenoPlugin
  - Description: options wiring, `getCommsService()` accessor, route mounting on `register()`
  - Files: `comms/src/commsApp.ts` + tests
  - Depends on: 1.5, 2.1
  - Acceptance: plugin registers on `TerrenoApp` and service accessor returns configured providers
- [x] **Task 2.3**: Push token routes
  - Description: custom idempotent registration/list/deactivation endpoints plus modelRouter owner read; persisted `userId` scoping
  - Files: `comms/src/routes/pushTokens.ts` + supertest
  - Depends on: 2.2
  - Acceptance: acceptance criteria bullets 2 pass under supertest
- [x] **Task 2.4**: Admin delivery explorer
  - Description: `GET /comms/messages` admin-only, paginated, filtered; OpenAPI builder
  - Files: `comms/src/routes/commsExplorer.ts` + supertest
  - Depends on: 2.2
  - Acceptance: non-admin gets 403; filters work
- [x] **Task 2.5**: `sendPushToUser` token resolution + pruning
  - Description: resolve active tokens per user; deactivate tokens whose `SendResult` reports permanent failure
  - Files: `comms/src/commsService.ts` + tests
  - Depends on: 2.1, 1.5
  - Acceptance: dead token is `active: false` after a failed send
  - Note: remaining prune-by-`errorClass` work is in Task 1.5

## Phase 3 — Integration + docs

- [x] **Task 3.1**: example-backend registration
  - Description: register `CommsApp` with console adapters; env-gated
  - Files: `example-backend/src/server.ts`
  - Depends on: 2.2
  - Acceptance: backend boots; `/comms/pushTokens` in `/openapi.json`
- [x] **Task 3.2**: Reference docs + rules
  - Description: `docs/reference/comms.md`, rulesync source rule, `bun run rules`
  - Files: `docs/reference/comms.md`, `.rulesync/**`
  - Depends on: 2.x
  - Acceptance: `bun run rules:check` passes
- [x] **Task 3.3**: CI + publish wiring
  - Description: `comms-ci` workflow; add `@terreno/comms` to `publish-on-tag.yml`
  - Files: `.github/workflows/comms-ci.yml`, `.github/workflows/publish-on-tag.yml`
  - Depends on: 1.x
  - Acceptance: CI green on the PR
- [x] **Task 3.4**: Docs refresh for gap-fill APIs
  - Description: document `beforeSend`, `recordDeliveryEvent`/`recordOptOut`, attempt history, payload retention, channel-wide retry, and the `onRetry`/`isPermanentFailure` aliases in reference docs + comms rule
  - Files: `docs/reference/comms.md`, `.rulesync/rules/comms/00-comms.md`
  - Depends on: 1.6, 1.7
  - Acceptance: `bun run rules:check` passes; docs match the Approved IP
