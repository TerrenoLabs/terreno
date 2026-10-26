# E2E testing guide

Run every package smoke from the repo root after the builds they test:

```bash
bun run compile && bun run --cwd admin-spa build:web && bun run --cwd demo export \
  && bun run --cwd example-frontend export:smoke && bun run smoke
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
| Manual regression | What only a person can do or judge: full flows across devices or channels, how the app feels, hardware and OS behavior | A person, before a release | `docs/regression/<area>.md` | none |

Unit tests are the default. A smoke exists once per package, not once per feature. A new e2e
spec is for a user-visible flow that crosses the frontend and backend. Automate first: a manual
case is only for a check that no automated tier can make, and only a person walks it.

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
- **About 30 s.** Each smoke finishes in 30 s or less, not counting the build. The CircleCI
  `smoke` job's results table judges the budget. `bun run smoke` marks a package over 30 s with
  `⏱ over 30 s budget` but does not fail it, because local times swing with machine load (see
  [Package pages](#package-pages)). A package over budget on CI gets fixed.

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
is the reference. A browser smoke that needs a backend works the same way: Bun runs
`smoke.spec.ts` as the driver, starts the server, then runs Playwright on Node against the same
file, which defines the browser test. [`admin-frontend/e2e/smoke.spec.ts`](https://github.com/TerrenoLabs/terreno/blob/master/admin-frontend/e2e/smoke.spec.ts)
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

The [regression suites index](../regression/README.md) lists the areas, restates the suite
format, and describes `bun run check:regression-suites`, which CI runs on every change to a
suite.

## Package pages

Each package page covers the package's test tiers, its smoke, how to add an e2e spec to it,
and the smoke's measured time. Every smoke's budget is 30 s, excluding the build.

| Package | Smoke | Layer | Measured time |
| --- | --- | --- | --- |
| [`@terreno/admin-backend`](e2e/admin-backend.md) | `admin-backend/e2e/smoke.ts` | http | 5.5–12.5 s |
| [`@terreno/admin-frontend`](e2e/admin-frontend.md) | `admin-frontend/e2e/smoke.spec.ts` | browser | 23–24.5 s (in-memory Mongo) |
| [`@terreno/admin-spa`](e2e/admin-spa.md) | `admin-spa/e2e/smoke.ts` | http | 4–4.5 s |
| [`@terreno/ai`](e2e/ai.md) | `ai/e2e/smoke.ts` | http | 7–7.5 s |
| [`@terreno/announcements`](e2e/announcements.md) | `announcements/e2e/smoke.ts` | http | 4.5–8 s |
| [`@terreno/api`](e2e/api.md) | `api/e2e/smoke.ts` | http | 5–10 s |
| [`@terreno/api-health`](e2e/api-health.md) | `api-health/e2e/smoke.ts` | http | 2 s |
| [`@terreno/blocks`](e2e/blocks.md) | `blocks/e2e/smoke.ts` | process | 1–1.5 s |
| [`@terreno/cli`](e2e/cli.md) | `cli/e2e/smoke.ts` | process | 2 s |
| [`@terreno/comms`](e2e/comms.md) | `comms/e2e/smoke.ts` | http | 5–6.5 s |
| [`create-terreno-app`](e2e/create-terreno-app.md) | `create-terreno-app/e2e/smoke.ts` | process | 2.5 s |
| [demo](e2e/demo.md) | `demo/e2e/smoke.spec.ts` | browser | CircleCI `smoke` job |
| [example-backend](e2e/example-backend.md) | `example-backend/e2e/smoke.ts` | http | 16–20 s |
| [example-frontend](e2e/example-frontend.md) | `example-frontend/e2e/smoke.spec.ts` | browser | 22–26 s (in-memory Mongo) |
| [`@terreno/feature-flags`](e2e/feature-flags.md) | `feature-flags/e2e/smoke.ts` | http | 5–5.5 s |
| [`@terreno/jobs`](e2e/jobs.md) | `jobs/e2e/smoke.ts` | http | 7.5–8.5 s |
| [`@terreno/mcp`](e2e/mcp-server.md) | `mcp-server/e2e/smoke.ts` | process, http | 5.5–6 s |
| [`@terreno/rtk`](e2e/rtk.md) | `rtk/e2e/smoke.ts` | http | 15–18 s |
| [`@terreno/syncdb`](e2e/syncdb.md) | `syncdb/e2e/smoke.ts` | http, websocket | 15–19 s |
| [`@terreno/test`](e2e/test.md) | `test/e2e/smoke.ts` | http | 2.5–3 s |
| [`@terreno/ui`](e2e/ui.md) | `ui/e2e/smoke.spec.ts` | browser | CircleCI `smoke` job |

The times are what `bun run smoke` printed for each package across three root runs (the runs
after the first one after a compile, described below) on a 4-CPU container, against a
single-node replica set (`TERRENO_TEST_MONGODB_URI`), after `bun run compile` and
`bun run --cwd admin-spa build:web` (admin-spa's time is from the two runs after its build). Each package page
records how its own time splits. The admin-frontend and example-frontend times come from
separate runs of each smoke on an idle container, with the in-memory replica set. The other
browser smokes were not timed locally; the CircleCI `smoke` job prints their times.

The first root run after a compile was slower for four packages: example-backend took 48 s,
syncdb 33 s, and create-terreno-app 21 s, and comms failed because its server did not answer
within its 20 s readiness timeout. All four were back within their usual times on the next run.
Run on its own right after the same compile, example-backend took 27 s on an empty database, and
ai and admin-backend took 5.5–7 s, though an earlier run after a compile had measured 41 s and
31.5 s for them.

Two causes outside the smokes were later measured on the same container, and either one stretches
a smoke well past its budget:

- **A compile running at the same time.** The agent `Stop` hook
  (`.rulesync/hooks/quality-check.sh`) runs `bun run compile` at the end of each agent turn. That
  keeps all four CPUs busy for about 4 minutes and rewrites `dist/` while smokes load it. In one
  root run that overlapped it, api took 75 s and jobs 93 s; alone, they take 5.5–9 s and 8.5–12 s.
  admin-spa's server also missed its 20 s readiness timeout once while the compile ran.
- **Slow disk.** The in-memory replica set keeps its data under `TMPDIR`. When that disk slowed
  to 20 MB fsyncs taking 2–122 s, mongod missed its 60 s start timeout in every later smoke.
  `dd if=/dev/zero of=$TMPDIR/ddtest bs=1M count=20 conv=fsync` shows whether this is the cause.

Time smokes on an otherwise idle machine. A smoke that is over budget only under one of these
conditions is not a regression. Full local runs on that container still put a different package
over 30 s each time (admin-frontend 44.7 s in one run; example-frontend 89.8 s and feature-flags
30.3 s in the next), while admin-frontend alone took 22.4–25.2 s. That noise is why the CI table,
not a local run, decides the budget.

A browser smoke that fails with `Executable doesn't exist` before it loads a page means the
machine's preinstalled Playwright browsers are a different build from the Playwright version
the repo locks. Install the matching Chromium under your home directory and run the smokes with
the same variable:

```bash
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright bunx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright bun run smoke
```

Manual cases that no smoke or e2e spec can check live in the
[regression suites](../regression/README.md).

## Related

- [Run tests locally](../how-to/run-tests-locally.md): the local command for every CI job
- [`@terreno/test` smoke helpers](../reference/test.md#smoke-helpers)
- [Test isolation in Bun suites](../explanation/test-isolation.md)
