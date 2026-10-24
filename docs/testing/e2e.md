# E2E testing guide

Run every package smoke from the repo root after the builds they test:

```bash
bun run compile && bun run --cwd admin-spa build:web && bun run --cwd demo export && bun run smoke
```

This guide covers how Terreno builds and writes end-to-end tests: the test tiers, where each
kind of spec lives, how specs find elements and wait, and the command that runs them. Each
package has its own page under [Package pages](#package-pages). Implementation plans cite this
guide in their `## E2E tests` section, and Pick writes each planned spec the way this page
describes.

## Test tiers

Each tier answers a question the tier below it cannot. Add a test to the lowest tier that can
prove the behavior.

| Tier | Proves | Runs in | Lives in | Command |
| --- | --- | --- | --- | --- |
| Unit and integration | Functions, routes, and components behave, in-process | `bun test`, in-memory Mongo | `<package>/src/**/*.test.ts(x)` | `bun run --cwd <package> test:ci` |
| Smoke | The package's built output works through its public entry in a real process | A child process, a real port, the compiled binary, or Chromium | `<package>/e2e/smoke.ts` or `smoke.spec.ts` | `bun run --cwd <package> smoke` |
| E2E | A user flow works across the running frontend and backend | Playwright (browser) or Maestro (flow) | `<package>/e2e/*.spec.ts`, `.maestro/flows/` | `bun run frontend:e2e`, `bun run maestro:test` |
| Manual regression | What no automated tier covers: native-only behavior, real email, OS permission prompts | A person, before a release | `docs/regression/<area>.md` | none |

Unit tests are the default. A smoke exists once per package, not once per feature. A new e2e
spec is for a user-visible flow that crosses the frontend and backend. A manual case is for a
check that no automated tier can make.

## Layers

An IP's `## E2E tests` rows name one of these layers.

| Layer | Spec location | Finds elements by | Waits for | Runs with |
| --- | --- | --- | --- | --- |
| `http` | `<package>/e2e/smoke.ts` | Response status and body | `spawnUntilReady` on a health URL | `bun run --cwd <package> smoke` |
| `process` | `<package>/e2e/smoke.ts` | Exit code, stdout, stderr | The process to exit (`runBin`) | `bun run --cwd <package> smoke` |
| `browser` | `<package>/e2e/*.spec.ts` | `getByTestId()` | A visible `testID` | `bun run --cwd <package> test:e2e`, or `smoke` for `smoke.spec.ts` |
| `native flow` | `.maestro/flows/*.yaml` | `id:` (the `testID`) | `extendedWaitUntil` on a visible `id` | `bun run maestro:test` |

Terreno's Maestro flows run against the web build today: each starts with a `url:` header. A
flow on a simulator, emulator, or device starts with an `appId:` header instead and runs with
`maestro --device <serial> test <flow.yaml>`. The repo has no device flows yet.

## Smoke conventions

A smoke follows one rule: **real process, built output, one happy path, about 30 s excluding
the build.**

- **Real process.** Start a server on a real port, run the compiled binary, or drive a page in
  Chromium. Do not import the package into the test process and call it. That duplicates the
  unit suite.
- **Built output.** Run against the result of `bun run compile` (or the web export for browser
  packages) through the package's public entry, the way a consumer gets it. Import the package
  by name (`@terreno/<package>`), never from `../src`.
- **One happy path.** Walk the package's main use once and throw on the first wrong response.
  Edge cases belong in unit tests.
- **About 30 s.** Each smoke finishes in 30 s or less, not counting the build.

| Item | Convention |
| --- | --- |
| File | `<package>/e2e/smoke.ts`; browser packages use `<package>/e2e/smoke.spec.ts` |
| Script | `"smoke"` in `<package>/package.json` (for example `"smoke": "bun e2e/smoke.ts"`) |
| Lint | Add `./e2e` to the package's `lint` and `lint:fix` scripts and `e2e/**/*.ts` to its `biome.jsonc` `files.includes`, as api does |
| Browser smoke | Serves the static web export (`dist/`), not Metro, and runs under its own Playwright config so the package's main e2e suite and its CI shards never pick it up |
| Helpers | `freePort`, `smokeMongoUri`, `spawnUntilReady`, `spawnExampleBackend`, `runBin` from `@terreno/test` ([reference](../reference/test.md#smoke-helpers)) |
| Mongo | `smokeMongoUri()`: the CI sidecar when `TERRENO_TEST_MONGODB_URI` is set, otherwise an in-memory replica set |
| Client packages | rtk, syncdb, and admin-frontend use `spawnExampleBackend()` and never import `@terreno/api` |
| Output | One `✅` line per check, then `<package> smoke passed in <ms> ms`; exit 1 on the first failure |
| Root runner | `bun run smoke` runs every workspace's `smoke` one at a time and prints each time; `bun run smoke api rtk` runs a subset |
| Package page | `docs/testing/e2e/<package>.md`, linked from [Package pages](#package-pages) |

A server smoke hosts its own server by re-running its file with a `serve` argument, so each
package keeps one smoke file. [`api/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/api/e2e/smoke.ts)
is the reference.

## Write a Playwright spec

Playwright specs drive the web build in Chromium. example-frontend holds the main suite;
admin-spa has its own.

1. Give the screen's root `View` a `testID`, and give every element the spec touches or asserts
   on a `testID`: buttons, inputs, error text, loading indicators, and list items (with
   dynamic IDs such as `todo-item-{id}`). Name them `{screen}-{element}-{qualifier}`, for
   example `login-screen-email-input`.
2. Create `e2e/<feature>.spec.ts`. Import `test` and `expect` from `./fixtures/test`, not
   `@playwright/test`: its `consoleGuard` fails a test that logs an unexpected `console.warn`,
   `console.error`, or page error. Group tests with `test.describe()` and name each test as a
   user behavior.
3. Pick the user. A spec that creates or clears data owns a per-suite user: add one with
   `suiteUser(...)` in `e2e/fixtures/testUsers.ts` and list it in `ALL_E2E_USERS` so
   `auth.setup.ts` creates it. `TEST_USER` is reserved for `todos.spec.ts` and the suites that
   change no todos.
4. In `test.beforeEach()`, reset that user's data (`clearTodosAs(user)` from
   `e2e/helpers/todosApi.ts`), then sign in with `loginAs(page, user)` from
   `e2e/helpers/login.ts`. On a syncdb screen, call `allowSyncDbNoise(consoleGuard)` and open the
   screen with `openSyncTodos(page)` from `e2e/helpers/syncdbSuite.ts`.
5. After each navigation or action, wait for the element that proves the new state.
6. Add the spec's base name to a shard's `specs` in `scripts/ci/e2eAffected/shards.ts`, plus any
   new screen it drives to that shard's `routes`, and to the same group in
   `.circleci/continue-config.yml` (`run_example_frontend_e2e`). Otherwise CI never runs it.
   `bun test scripts/ci/e2eAffected/` checks the shard lists.

```typescript
import {expect, test} from "./fixtures/test";
import {DUE_DATE_USER} from "./fixtures/testUsers"; // this spec's suiteUser() from step 3
import {loginAs} from "./helpers/login";
import {allowSyncDbNoise, openSyncTodos, todoItemByTitle} from "./helpers/syncdbSuite";
import {clearTodosAs} from "./helpers/todosApi";

test.describe("Todos", () => {
  test.beforeEach(async ({page, consoleGuard}) => {
    allowSyncDbNoise(consoleGuard);
    await clearTodosAs(DUE_DATE_USER);
    await loginAs(page, DUE_DATE_USER);
    await openSyncTodos(page);
  });

  test("user can create a todo", async ({page}) => {
    await page.getByTestId("todos-title-input").fill("Buy milk");
    await page.getByTestId("todos-create-button").click();
    await expect(todoItemByTitle(page, "Buy milk")).toBeVisible();
    await expect(page.getByTestId("todos-title-input")).toHaveValue("");
  });
});
```

| Do | Don't |
| --- | --- |
| `getByTestId()` first, `getByRole()` for third-party components | Select by class name; React Native Web's `.css-*` classes change every build |
| `waitFor({state: "visible"})` on the target, or wait for a spinner to hide | `waitForTimeout()` |
| Keep each test independent, with its own data | Depend on another test's state |
| `getByText()` only for text you assert on | Deep structural selectors such as `div > div > div` |

React Native Web renders `View` as `div`, `Pressable` as `div role="button"`, `TextInput` as
`input` or `textarea`, and `Switch` as `div role="switch"` with `aria-checked`.

Run the suite with `bun run frontend:e2e` (it starts the backend and the web app and needs a
replica-set `mongod`). Run one file with `cd example-frontend && bunx playwright test
e2e/todos.spec.ts`. CircleCI runs the specs in named shards (`auth`, `app`, `admin-core`, …),
each a group of spec files, and skips a shard no changed file can reach. Check that verdict
with `bun run check:e2e-affected`.

## Write a Maestro flow

Maestro flows walk the same `testID`s a user would. Terreno's flows run against the web build,
locally and in CI.

1. Add `.maestro/flows/<feature>.yaml` with a `url:` header. A standalone flow then starts with
   `launchApp`. A flow that runs after `login` starts with no `launchApp`, because that resets
   the session, and first waits for the screen `login` ends on (`todos-screen`).
2. Find elements with `id:`, which matches the `testID`.
3. Wait with `extendedWaitUntil` on a visible `id` and an explicit `timeout`, never a fixed
   sleep.
4. Add the file to `flows:` in `.maestro/flows/config.yaml`, or `bun run maestro:test` skips it.
   When it runs after `login`, also add its name (without `.yaml`) to
   `executionOrder.flowsOrder`.

```yaml
url: http://localhost:8082/login
---
- launchApp
- extendedWaitUntil:
    visible:
      id: "login-screen-email-input"
    timeout: 60000
- tapOn:
    id: "login-screen-email-input"
- inputText: "admin@example.com"
```

Run every flow with `bun run maestro:test`, or the demo flows with `bun run demo:maestro:test`.
Local runs need the running example-frontend on port 8082 (`bun run frontend:web`), and the demo
flows need the demo's static export served on port 8085 (`bun run --cwd demo export`, then
`bunx serve demo/dist -l 8085`, as CI does).

## Where regression suites live

Manual regression cases live in `docs/regression/<area>.md`, one living file per area with
stable case IDs such as `AUTH-004`. An IP lists the cases it adds under `## Regression cases`,
and Brew writes them into the suite with real IDs before it opens the PR. A case belongs there
only when no unit test, smoke, or e2e spec can check it.

## Package pages

Each package page covers the package's test tiers, its smoke, how to add an e2e spec to it,
and the smoke's measured time.

| Package | Smoke | Layer | Measured time |
| --- | --- | --- | --- |
| [`@terreno/api`](e2e/api.md) | `api/e2e/smoke.ts` | http | 13 s idle, up to 26 s under load |

Each remaining package is added here as its smoke lands.

## Related

- [Run tests locally](../how-to/run-tests-locally.md): the local command for every CI job
- [`@terreno/test` smoke helpers](../reference/test.md#smoke-helpers)
- [Test isolation in Bun suites](../explanation/test-isolation.md)
