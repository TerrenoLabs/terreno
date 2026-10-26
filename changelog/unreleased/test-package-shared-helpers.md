---
category: Added
---

`@terreno/test` gains the test helpers Flourish built and proved in its own suites:

- `waitUntil` / `waitForCalls` to poll a condition instead of sleeping, and `freezeTime` to
  freeze `Date.now()`, `new Date()`, and Luxon together.
- `authWithToken` for a supertest agent with a pre-minted token (no login round-trip),
  `expectAPIError` for `APIError` bodies, and `assertStrictResponseProperties` to fail on any
  response field outside an allowlist.
- Opt-in `mock.module` registrars for Cloud Tasks (with `drainTasks`), SendGrid, Twilio, Expo
  push, GCS, Google auth, and the `@terreno/api` notifiers, plus `createMockLanguageModel` for
  the AI SDK.
- `@terreno/test/expo/*`: `registerExpoTestEnvironment`, `renderWithTerreno`, in-memory auth
  token storage, and a module-alias mocker for Bun + Expo tests. `example-frontend` now uses it.
- `terreno-test-shard` (weighted test sharding) and `terreno-test-hygiene` (AST lint for leaky
  or flaky Bun test patterns, with a baseline) CLIs.
