# @terreno/test

Shared Bun test helpers for Terreno backend packages: in-memory MongoDB lifecycle, auth env defaults, HTTP fixtures, and log silencing.

## Install

```bash
bun add -d @terreno/test mongoose
```

`mongoose` is a peer dependency (>= 8.0.0). The Expo/React Native setup under
`@terreno/test/expo/*` adds optional peers; see [Expo / React Native](#expo--react-native).

## Commands

From the `@terreno/test` package directory:

```bash
bun run compile    # Compile TypeScript
bun run test       # Run package tests
bun run lint       # Lint code
```

Consumers typically run `bun test` in their own package with a `bunfig.toml` preload (see below).

## Preload pattern

Add a `bunfig.toml` preload that wires MongoDB and test env before any test file runs. Example from `admin-backend/bunfig.toml`:

```toml
[test]
preload = ["./src/tests/bunSetup.ts"]
root = "./src"
```

Example preload (`admin-backend/src/tests/bunSetup.ts`):

```typescript
import {registerSimpleMongoPreload} from "@terreno/test";

process.env.TERRENO_TEST_USE_MEMORY_MONGO = "true";

registerSimpleMongoPreload({
  testEnv: {
    tokenIssuer: "terreno-admin-backend.test",
  },
});
```

The `@terreno/api` package uses a two-file preload (`api/bunfig.toml`): `./src/tests/testEnv.ts` then `./src/tests/bunSetup.ts`, which calls `registerBackendPreload` or `registerSimpleMongoPreload` depending on fixture-cache settings.

Import the memory-Mongo flag alone when you only need the env var:

```typescript
import "@terreno/test/preload/memoryMongo";
```

That sets `TERRENO_TEST_USE_MEMORY_MONGO=true` before other preload logic runs.

## Test environment

Call `setTerrenoTestEnv()` from a preload or `beforeEach` to apply canonical auth secrets and validate required vars (via internal `setupTestEnvironment()`):

```typescript
import {setTerrenoTestEnv} from "@terreno/test";

setTerrenoTestEnv({
  tokenIssuer: "my-package.test",
  tokenSecret: "secret",
  refreshTokenSecret: "refresh",
  sessionSecret: "session",
});
```

Defaults: `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, `NODE_ENV=test`, `TZ=UTC`.

## Environment variables

| Variable | Effect |
|----------|--------|
| `TERRENO_TEST_USE_MEMORY_MONGO` | When `"true"`, `registerSimpleMongoPreload` starts `mongodb-memory-server` if `TERRENO_TEST_MONGODB_URI` is unset. |
| `TERRENO_TEST_MONGODB_URI` | External MongoDB URI. Takes priority over in-memory server in `startMongoServer` and `registerSimpleMongoPreload`. |
| `TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS` | Per-mongod start timeout for in-memory servers started by `startMongoServer`. Default `60000` (mongodb-memory-server's own default is 10s). Startup is tried twice. |
| `BUN_TEST_DISABLE_DB` | When `"true"`, `registerBackendPreload` skips all Mongo `beforeAll`/`afterAll` hooks (no DB startup). |

`startMongoServer` also publishes the resolved URI to `TERRENO_TEST_MONGO_URI` and honors `TERRENO_TEST_USE_REPLSET=true` for replica-set memory servers.

If `registerBackendPreload` cannot start Mongo, every later test fails at once with
`MongoDB test server failed to start` instead of waiting on mongoose command buffering.

## Exported helpers

| Export | Description |
|--------|-------------|
| `registerBackendPreload` | Full lifecycle: memory/external Mongo, optional transactions, Sentry mock, log silencing. |
| `registerSimpleMongoPreload` | Lightweight connect-once pattern (used by most packages). |
| `setTerrenoTestEnv` | Apply and validate auth test env vars. |
| `startMongoServer` / `stopMongoServer` | Start or stop shared in-memory Mongo and connect mongoose. |
| `getMongoServerUri` | Resolved URI after `startMongoServer`. |
| `resolveMongoLaunchTimeoutMs` | In-memory mongod launch timeout from `TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS` (integer ≥ 1000), default 60000. |
| `getBaseServer` | Build an Express app for supertest from route registrars. |
| `authAsUser` | Login helper returning auth headers for supertest. |
| `createMongoTestCache` | Fixture-cache controller for fast `@terreno/api` tests. |
| `registerLogSilencing` / `createLogSilencer` | Suppress Winston noise in tests. |
| `registerSentryBunMock` | Mock `@sentry/bun` in preload. |
| `ensureTestMongooseConnected` | Connect mongoose to test URI with retries. |
| `waitForDocument` / `waitForDocuments` | Poll until documents match a query. |
| `startTestTransaction` / `abortTestTransaction` | Per-test mongoose transactions when enabled. |
| `TestTransactionOperationCancelledError` / `isTestTransactionOperationCancelled` | Error a queued DB operation rejects with when a test ends before it runs; the check follows `cause` chains. |
| `waitUntil` / `waitForCalls` | Poll a predicate or a mock's call count instead of sleeping. |
| `freezeTime` | Freeze `Date.now()`, `new Date()`, and Luxon at one instant for the current test. |
| `authWithToken` | Supertest agent with a pre-minted bearer token (skips `POST /auth/login`). |
| `expectAPIError` | Assert a response is the JSONAPI error body `APIError` produces. |
| `assertStrictResponseProperties` | Fail when a response exposes a field outside an allowlist. |
| `register*Mock` / `createMockLanguageModel` | Opt-in mocks for Cloud Tasks, SendGrid, Twilio, Expo push, GCS, Google auth, the AI SDK, and `@terreno/api` notifiers. |

## Per-test transactions

With `registerBackendPreload({useTransactions: true})`, each test runs inside a Mongo
transaction that is aborted afterwards, and DB operations are serialized through one session.
`abortTestTransaction({drainTimeoutMs = 3000})` first waits for in-flight operations, including
fire-and-forget writes the test did not await, so they cannot run against the aborted
transaction or commit for real. If they do not settle in time, the session is quarantined, the
operations still queued reject with `TestTransactionOperationCancelledError`, and the test fails
with `Timed out waiting for N serialized operation(s) to drain`.

`bun test` reports an unawaited rejection itself and does not call
`process.on("unhandledRejection")` listeners, so a fire-and-forget write that hits the
cancellation fails the test. Await such writes in tests, or catch and check
`isTestTransactionOperationCancelled(error)`.

## Async and time helpers

Poll the condition a test is waiting for instead of sleeping a fixed time:

```typescript
import {freezeTime, waitForCalls, waitUntil} from "@terreno/test";

await waitUntil(() => socket.connected, {label: "socket connect", timeoutMs: 2000});
await waitForCalls(sendMock, 2);
```

`waitUntil(predicate, {timeoutMs = 1000, intervalMs = 10, label})` throws
`waitUntil timed out after <n>ms waiting for: <label>`. It measures elapsed time with
`performance.now()`, so it keeps working while the clock is frozen. For rendered output in
React Native tests, use `waitFor` from `@testing-library/react-native` instead.

`freezeTime(isoOrDateTime, {restoreAfterEach = true})` freezes `Date.now()`, `new Date()`, and
Luxon's `DateTime.now()` (Bun `setSystemTime` plus a `Date.now` override, so it still wins over
a preload that replaced `Date.now`). Call it in `beforeEach` or inside a test; it restores the
previous clock after that test. Nested freezes unwind to the outer instant. The returned
function un-freezes early. Do not mix it with direct `setSystemTime` calls in the same test.

## HTTP and assertion helpers

`authAsUser` logs in through `POST /auth/login`, which pays the password-hash cost on every
call. When the test is not about login, mint the token and use `authWithToken`:

```typescript
import {generateTokens} from "@terreno/api";
import {authWithToken, expectAPIError, assertStrictResponseProperties} from "@terreno/test";

const {token} = await generateTokens(user, authOptions);
const agent = await authWithToken(app, {headers: {"app-version": "1.10.0"}, token});

const res = await agent.post("/todos").send({});
expectAPIError(res, {fields: {title: "Required"}, status: 400, title: "Validation failed"});

const list = await agent.get("/users").expect(200);
assertStrictResponseProperties(list.body, ["data._id", "data.name", "limit", "more", "page", "total"]);
```

- `expectAPIError(res, {status, title?, detail?, code?, fields?})` checks the HTTP status and
  `body.status`, plus only the keys you pass. `title` and `detail` accept a string or `RegExp`;
  `fields` is a partial match on `body.meta.fields`.
- `assertStrictResponseProperties(body, allowedPaths)` lists every dot path in the body (array
  items add no segment, so `data.email` covers each list item) and throws naming every path that
  is not listed, an ancestor of a listed path, or under one. Use it on permission-scoped
  endpoints so a new model field or populate cannot leak PHI or secrets unnoticed.

## Service mocks

Each registrar calls `mock.module` for one SDK, returns the mock functions, and has `reset()`
to clear calls and restore defaults. The SDK does not need to be installed. Call the registrar
in the package preload (or at the top of a test file before importing code that loads the SDK);
`mock.module` lasts for the whole process.

| Registrar | Module | Highlights |
|-----------|--------|------------|
| `registerCloudTasksMock()` | `@google-cloud/tasks` | `getEnqueuedTasks()` decodes base64 bodies; `drainTasks({app, path?, headers?, filter?, expectStatus?, maxRounds?})` POSTs each task to the app with supertest. |
| `registerSendGridMock()` | `@sendgrid/mail` | `send`, `setApiKey`, `getSentMessages()`. |
| `registerTwilioMock()` | `twilio` | `messagesCreate`, Verify `verificationsCreate` / `verificationChecksCreate` (approves any code). |
| `registerExpoPushMock()` | `expo-server-sdk` | `sendPushNotificationsAsync`, receipts, `isExpoPushToken`, `getSentMessages()`. |
| `registerGcsMock()` | `@google-cloud/storage` | In-memory buckets; missing files fail with `code: 404`; `putObject` / `getObject` / `listObjects` for setup and assertions. |
| `registerGoogleAuthMock(options?)` | `google-auth-library` | `GoogleAuth` clients and `OAuth2Client.verifyIdToken`. |
| `registerTerrenoNotifierMocks()` | `@terreno/api` | Replaces `sendToSlack`, `sendToZoom`, `sendToGoogleChat`; keeps every other export. Calls made inside `@terreno/api` itself still use the real notifiers. |
| `createMockLanguageModel(options?)` | — | Scripted AI SDK language model (text, tool calls, errors, one response per call) for `AIService` and `generateText` / `streamText`. |

```typescript
import {registerCloudTasksMock} from "@terreno/test";

const tasks = registerCloudTasksMock();

it("runs the reminder task", async () => {
  await agent.post("/reminders").send({}).expect(201);
  await tasks.drainTasks({app, path: "/tasks/process"});
});
```

## Expo / React Native

`@terreno/test/expo/*` is a Bun test setup for Expo apps. It runs from TypeScript source, so it
needs Bun. It needs the optional peers `react`, `react-native`,
`@testing-library/react-native`, and `@terreno/ui` (plus `react-redux` when you pass a store);
the backend entry point never loads them.

```toml
# bunfig.toml
[test]
preload = ["./tests/testPreload.ts"]
```

```typescript
// tests/testPreload.ts
import {registerExpoTestEnvironment} from "@terreno/test/expo/registerExpoTestEnvironment";

registerExpoTestEnvironment({expoConfig: {extra: {}, scheme: "myapp"}});
```

`registerExpoTestEnvironment` mocks `react-native`, the common `expo-*` modules, `expo-router`,
`@expo/vector-icons`, and common RN libraries (reanimated, gesture handler, SVG, AsyncStorage,
NetInfo, SecureStore), serves image and font imports as asset stubs, and sets `__DEV__`, `TZ`,
and `EXPO_OS`. After each test it restores spies, empties stored tokens, and resets `__DEV__`.
Options: `skip`, `overrides`, `platform`, `timeZone`, `locale`, `expoConfig`, `scheme`,
`fixedNow`, `cleanup`, `resolveFrom`, `nestedPackagePrefixes`. It returns
`{mockedModules, restoreModuleMock(specifier)}`.

| Subpath | Exports |
|---------|---------|
| `expo/registerExpoTestEnvironment` | `registerExpoTestEnvironment`, `createDefaultExpoModuleMocks`, `ASSET_FILE_PATTERN` |
| `expo/renderWithTerreno` | `renderWithTerreno(ui, {store?, theme?, wrapper?, ...renderOptions})`, `createTerrenoWrapper` (for `renderHook`) |
| `expo/authTokenStorage` | In-memory SecureStore / AsyncStorage: `setAuthTokens`, `clearAuthTokenStorage`, `TERRENO_AUTH_TOKEN_KEYS` (JWT `AUTH_TOKEN` / `REFRESH_TOKEN` and Better Auth keys) |
| `expo/mockModuleAliases` | `createModuleAliasMocker({aliases, rootDir?})`: mock a module under every cache key Bun may use (alias and resolved path), starting from its real exports |
| `expo/reactNativeMock`, `expo/expoModuleMocks`, `expo/libraryModuleMocks`, `expo/mockHelpers` | The individual mock factories, for apps that build their own set |

`example-frontend/tests/testPreload.ts` is a working example.

## CLIs

Both CLIs need Bun.

`terreno-test-shard` splits test files into balanced shards for parallel CI. Each file weighs
`lines + 50 * testCount`; files are assigned heaviest first.

```bash
terreno-test-shard --shard 2/4 --list            # print this shard's files
terreno-test-shard --shard 2/4 -- --timeout 30000 # run them; args after -- go to bun test
```

Flags: `--pattern`, `--exclude`, `--exclude-dir`, `--lines-per-test`, `--fail-fast`, `--cwd`,
`--isolate <glob>` / `--isolate-file <list>` (run matching files in their own process), and
`--process-per shard|dir|file` with `--dir-depth`. A run that matches no files exits 1.

`terreno-test-hygiene` lints test files for patterns that make Bun suites flaky or leaky:

| Rule | Flags |
|------|-------|
| `no-module-scope-mock-module` | `mock.module` at module scope (it leaks into every later file in the process). |
| `no-direct-barrel-mock` | Mocking a barrel module directly (configure `--barrel-alias` / `--barrel-path`). |
| `no-sleep` | Fixed sleeps (`setTimeout` promises, `Bun.sleep`, `--sleep-callee`); use `waitUntil`. |
| `no-cache-busted-import` | `import("./x?t=...")` cache-busting. |
| `no-late-real-capture` | Capturing a barrel's real exports inside a mock factory, after mocks may already be registered; capture them at module scope first. |
| `no-component-snapshot` | `expect(Component).toMatchSnapshot()` on an imported reference instead of rendered output. |

```bash
terreno-test-hygiene --root src --baseline test-hygiene-baseline.json
terreno-test-hygiene --update-baseline   # record current counts
```

Settings come from `--config` or `./test-hygiene.config.json` plus flags. A baseline holds
per-file, per-rule counts so CI fails only on new violations. Suppress one line with a
`test-hygiene-disable-next-line <rule>[, <rule>]` comment. Exit codes: 0 clean, 1 new
violations, 2 usage error.

### Documented-response checks (`@terreno/api/testing`)

`expectDocumentedResponse({spec, path, method, response})` validates a real response body
against the schema `/openapi.json` documents for that path, method, and status (AJV, with
`#/components/...` refs and `nullable` resolved). It throws listing every violation, or when
the route, status, or media type is not documented. `validateDocumentedResponse` returns
`{valid, errors}` instead of throwing. `path` is the OpenAPI template
(`/announcements/{id}/click`); pass the supertest response as `response`.

`@terreno/api/testing` also registers api's own test models (including `User`). A package
that defines its own `User` model imports the same two functions from the side-effect-free
`@terreno/api/testing/openApi` entry instead, so one test process never compiles `User` twice.

```typescript
import {authAsUser, expectDocumentedResponse} from "@terreno/api/testing";

const spec = (await supertest(app).get("/openapi.json")).body;
const agent = await authAsUser(app, "notAdmin");
const res = await agent.get("/auth/me").expect(200);
expectDocumentedResponse({method: "get", path: "/auth/me", response: res, spec});
```

## Conventions

- Preload once per package via `bunfig.toml`; do not start Mongo in individual test files.
- Prefer `registerSimpleMongoPreload` unless you need transactions or fixture caching (`registerBackendPreload`).
- Never mock `@terreno/api` or Mongoose models in package tests — use the real stack against memory Mongo.

## Coverage gates

Package CI uses `scripts/check-coverage.ts` (`bun run test:coverage`, default 95%
functions and lines) as the live gate. Bun 1.4.2+ may exit 1 on bunfig
`coverageThreshold` before isolated LCOV merges; the script continues when tests
reported `0 fail` and then enforces 95% on the merged report. The blocks
coverage pass sets `--max-concurrency=1`, because Bun's default 20-way run
exits 0 on a 2-vCPU worker before it prints the `All files` row. When that
row is still missing after one retry, the script uses `coverage/lcov.info`
only if it lists every non-test source file under `src/`. Dedicated CircleCI
jobs (`api-ci`, `ai-ci`, `blocks-ci`,
`ui-ci`, `syncdb-ci`, `comms-ci`, `mcp-server-ci`, `admin-spa-ci`) run
that script. Published packages without a dedicated workflow
(`admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `@terreno/test`)
run the same lint, compile, and coverage commands via the parameterized
`packages-ci` job. Retained GitHub Actions twins stay in lockstep (`push.branches-ignore: ["**"]`),
including `.github/workflows/packages-ci.yml`. Those twins run
`scripts/ci/check-new-file-coverage-lcov.sh` with `working-directory: .` and
pass `secrets.CODECOV_TOKEN` into `upload-codecov`.

Each of those jobs then uploads `coverage/lcov.info` to Codecov with a distinct
flag (`api`, `ui`, `syncdb`, …) via `scripts/upload-codecov.sh`. The script
downloads the linux uploader over HTTPS and refuses to run it unless the
SHA-256 digest matches the pin in the script (`CODECOV_UPLOADER_SHA256`).
`codecov.yml` sets per-package flags, `target: auto` with a 1% threshold so
trivial deltas do not fail PRs, and PR comments for the coverage diff. Uploads
skip when `CODECOV_TOKEN` is unset. Maintainers set that token in CircleCI
project env and as a GitHub Actions secret. For a public repo, Codecov still
requires a token unless the org disables token authentication for public
repositories (see [Codecov tokens](https://docs.codecov.com/docs/codecov-tokens)).

Demo CI uses `scripts/check-demo-coverage.ts` to fail when a PascalCase component
exported from `ui/src/index.tsx` has neither a `demo/story-config` registration nor
an allowlist reason in `DEMO_COVERAGE_ALLOWLIST`. Run it from the repo root:

```bash
bun run check:demo-coverage
```

The `demo_lint_and_typecheck` CircleCI command (and the retained
`.github/workflows/ui-demo-ci.yml` job) runs the unit tests and this check after
the demo compiles. Add a story plus `demoConfig.tsx` registration for new
components, or an allowlist entry with a specific reason — not "hard to demo".
The allowlist is limited to shell/providers, React context objects, thin RN
list wrappers, subcomponents already exercised by a parent story
(DropdownPanel, Table, DateTimeField, HeightField, ConsentFormScreen), and
product surfaces that belong in `example-frontend` rather than the isolated
UI demo (announcements and in-app notifications).
Standalone picker sheets (`NumberPickerActionSheet`, `DecimalRangeActionSheet`)
have their own demo stories.

`demo/package.json` `test:ci` runs Bun tests, including a smoke suite that mounts every
registered `DemoConfig` demo and story through `renderWithTheme` from
`@terreno/ui`'s test utilities (`demo/storiesSmoke.test.tsx`).

Pull requests also run the `New file coverage` workflow. Every newly added workspace
`.ts` or `.tsx` implementation file must have at least 90% function coverage and 90%
line coverage. Test, spec, story, generated OpenAPI SDK, `dist`, isolated-test,
`src/types` type modules, demo `story-config/*.config.tsx`, and Expo Router route
files (`index`, `_layout`, `+not-found`, `[param]`, plus example recovery screens
`forgotPassword` / `resetPassword` / `verifyEmail`) are excluded. A new implementation
file that is absent from LCOV is treated as 0% covered, except files listed in
that package's `bunfig.toml` `coveragePathIgnorePatterns` (the same paths the
95% package gate already omits). Package CI jobs that
already produced `coverage/lcov.info` run the 90% check against that report
(`--package` + `--lcov`) so the dedicated job does not rerun the suite.
When the dedicated job does rerun a package, it prefers colocated
`foo.test.ts` / `foo.test.tsx` next to each new `foo.ts` and falls back to
the package `bun test` paths only when a new file has no sibling test.
It compiles `@terreno/*` workspace dist deps only when the package imports
them. The gate still expands globs before spawn so Playwright `*.spec.ts`
files are not collected. A glob that matches no files is omitted.

Run the same check locally against a base commit:

```bash
bun run check:new-file-coverage --base=origin/master --threshold=90
```
