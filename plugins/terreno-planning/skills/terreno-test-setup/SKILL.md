---
name: terreno-test-setup
description: >-
  Bootstrap or repair the test setup of a Terreno app: backend Bun tests with in-memory
  Mongo, frontend Bun + React Native Testing Library unit tests and Playwright web E2E, and
  mobile Maestro flows on iOS/Android. Use when an app has no tests yet, `bun test` finds
  nothing or crashes on import, a new backend/frontend/mobile package needs tests, or CI needs
  a test job or sharding. Not for writing individual tests — use terreno-backend-tests,
  terreno-frontend-tests, or terreno-mobile-tests.
---

# Terreno test setup

Bootstrap one layer at a time. Each layer is done only when its completion check passes.
Apps from `create-terreno-app` have `"test": "bun test"` scripts but no preload, helpers, or
example test, so start with the backend.

## 0. Inventory

1. Read `backend/package.json`, `frontend/package.json`, every `bunfig.toml`, and any
   existing `*.test.ts(x)`, `e2e/`, or `.maestro/` / `maestro/` directory.
2. Note the installed `@terreno/*` version. All `@terreno/*` packages share one version, so
   `@terreno/test` must match it.
3. Pick the layers the user asked for. "Set up tests" with no qualifier means backend +
   frontend unit; add Playwright and Maestro only when asked or when CI already expects them.

Done when: you can name, per layer, what exists and what is missing.

## 1. Backend (Bun + in-memory Mongo)

Follow [references/backend.md](references/backend.md): add `@terreno/test`, a `bunfig.toml`
preload that calls `registerBackendPreload`, service mocks registered once in that preload,
and one route test.

Done when: `cd backend && bun test` passes with the example route test while the dev
`mongod` is stopped (proves the suite uses the in-memory server, not the dev database).

## 2. Frontend unit tests (Bun + React Native Testing Library)

Follow [references/frontend.md](references/frontend.md): add `@terreno/test`,
`@testing-library/react-native@^13`, and `react-test-renderer`, a preload that calls
`registerExpoTestEnvironment`, and one component test using `renderWithTerreno`.

Done when: `cd frontend && bun test` passes with the example component test.

## 3. Frontend web E2E (Playwright)

Follow [references/frontend.md#playwright-web-e2e](references/frontend.md#playwright-web-e2e):
`playwright.config.ts` with `webServer` entries for backend + web, `e2e/auth.setup.ts`,
`e2e/helpers/login.ts` (`loginAs`), and one spec selecting by `testID`.

Done when: `bunx playwright test` passes locally against a replica-set Mongo.

## 4. Mobile (Maestro on iOS / Android)

Follow [references/mobile.md](references/mobile.md): a dev-client build on a simulator or
emulator, `maestro/config.yaml` plus one login flow keyed by `testID`, and optional
per-platform unit runs.

Done when: `maestro test maestro/` passes on at least one platform the user targets, and you
recorded which platforms and devices were exercised.

## 5. Scripts and CI

1. Package scripts: `test` (local), `test:ci` (same suite, no watch), plus `test:e2e` and
   `test:maestro` when those layers exist.
2. Large suites: shard with `terreno-test-shard --shard <i>/<n>` (ships with
   `@terreno/test`); add `terreno-test-hygiene --update-baseline` once, then run
   `terreno-test-hygiene` in CI so new flaky patterns fail. See
   [references/backend.md#ci](references/backend.md#ci).
3. E2E and Maestro jobs need a replica-set `mongod`, the backend, and the web or native app
   running; unit jobs need nothing but `bun install`.

Done when: every layer you set up has a script, and the CI config (if the repo has one)
runs each script.

## Finish

Report each layer as set up / skipped / blocked with the exact command that proves it, then
point the user at the matching writing skill: `terreno-backend-tests`,
`terreno-frontend-tests`, `terreno-mobile-tests`.
