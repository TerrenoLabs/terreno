# @terreno/test

Shared Bun test helpers for Terreno backend packages: in-memory MongoDB lifecycle, auth env defaults, HTTP fixtures, and log silencing.

## Install

```bash
bun add -d @terreno/test mongoose
```

`mongoose` is a peer dependency (>= 8.0.0).

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
| `BUN_TEST_DISABLE_DB` | When `"true"`, `registerBackendPreload` skips all Mongo `beforeAll`/`afterAll` hooks (no DB startup). |

`startMongoServer` also publishes the resolved URI to `TERRENO_TEST_MONGO_URI` and honors `TERRENO_TEST_USE_REPLSET=true` for replica-set memory servers.

## Exported helpers

| Export | Description |
|--------|-------------|
| `registerBackendPreload` | Full lifecycle: memory/external Mongo, optional transactions, Sentry mock, log silencing. |
| `registerSimpleMongoPreload` | Lightweight connect-once pattern (used by most packages). |
| `setTerrenoTestEnv` | Apply and validate auth test env vars. |
| `startMongoServer` / `stopMongoServer` | Start or stop shared in-memory Mongo and connect mongoose. |
| `getMongoServerUri` | Resolved URI after `startMongoServer`. |
| `getBaseServer` | Build an Express app for supertest from route registrars. |
| `authAsUser` | Login helper returning auth headers for supertest. |
| `createMongoTestCache` | Fixture-cache controller for fast `@terreno/api` tests. |
| `registerLogSilencing` / `createLogSilencer` | Suppress Winston noise in tests. |
| `registerSentryBunMock` | Mock `@sentry/bun` in preload. |
| `ensureTestMongooseConnected` | Connect mongoose to test URI with retries. |
| `waitForDocument` / `waitForDocuments` | Poll until documents match a query. |
| `startTestTransaction` / `abortTestTransaction` | Per-test mongoose transactions when enabled. |

## Conventions

- Preload once per package via `bunfig.toml`; do not start Mongo in individual test files.
- Prefer `registerSimpleMongoPreload` unless you need transactions or fixture caching (`registerBackendPreload`).
- Never mock `@terreno/api` or Mongoose models in package tests — use the real stack against memory Mongo.

## Coverage gates

Package CI uses `scripts/check-coverage.ts` (`bun run test:coverage`, default 95%
functions and lines) as the live gate. Bun 1.4.2+ may exit 1 on bunfig
`coverageThreshold` before isolated LCOV merges; the script continues when tests
reported `0 fail` and then enforces 95% on the merged report. Dedicated CircleCI
jobs (`api-ci`, `ai-ci`,
`rtk-ci`, `ui-ci`, `syncdb-ci`, `comms-ci`, `mcp-server-ci`, `admin-spa-ci`) run
that script. Published packages without a dedicated workflow
(`admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `@terreno/test`)
run the same lint, compile, and coverage commands via the parameterized
`packages-ci` job. Retained GitHub Actions twins stay in lockstep (`push.branches-ignore: ["**"]`),
including `.github/workflows/packages-ci.yml`. Those twins run
`scripts/ci/check-new-file-coverage-lcov.sh` with `working-directory: .` and
pass `secrets.CODECOV_TOKEN` into `upload-codecov`.

Each of those jobs then uploads `coverage/lcov.info` to Codecov with a distinct
flag (`api`, `ui`, `rtk`, …) via `scripts/upload-codecov.sh`. The script
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
