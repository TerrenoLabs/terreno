# Tasks: Comms adapter — Expo push notifications

IP: [comms-adapter-expo-push](../implementationPlans/comms-adapter-expo-push.md)

- [x] **Task 1**: `ExpoPushProvider` implementation
  - Description: token validation, chunked send, ticket collection per IP
  - Files: `comms/src/adapters/expoPush.ts`
  - Depends on: comms-abstraction Phase 1
  - Acceptance: mocked-client tests pass, one `SendResult` per token
- [x] **Task 2**: Receipt polling → `DeliveryEvent` + dead-token marking
  - Description: poll receipts after configurable delay; map `DeviceNotRegistered` to permanent failure
  - Files: `comms/src/adapters/expoPush.ts`
  - Depends on: Task 1
  - Acceptance: dead token deactivated in test
- [x] **Task 3**: Dependency moves
  - Description: optional peer `expo-server-sdk` on comms; remove from `@terreno/api`
  - Files: `comms/package.json`, `api/package.json`, root catalog if needed
  - Depends on: Task 1
  - Acceptance: `bun install` + full compile pass; api tests unaffected
- [x] **Task 4**: example-frontend token registration + dev test-send
  - Description: register token on login via `POST /comms/pushTokens`; profile dev row triggers `sendPushToUser`
  - Files: `example-frontend/app/_layout.tsx` or profile screen, `example-backend` dev route
  - Depends on: Task 1, comms-abstraction Phase 2
  - Acceptance: UI verification per verify-ui-changes with screenshots
- [x] **Task 5**: Docs
  - Description: adapter section in `docs/reference/comms.md` with env/config table
  - Files: `docs/reference/comms.md`
  - Depends on: Task 1
  - Acceptance: docs build passes
