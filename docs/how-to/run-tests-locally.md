# Run Terreno tests locally

Every CircleCI test job has a local command. On Cursor Cloud, run the failed tests
from the last CI run with these commands before pushing.

Package unit tests use in-memory Mongo from `@terreno/test`. Playwright, Maestro, and
the example-backend **dev** server need a replica-set `mongod` (see
[AGENTS.md](https://github.com/TerrenoLabs/terreno/blob/master/AGENTS.md) Cursor Cloud
section).

## Do now — prepush mirrors CI

```bash
bun run prepush            # lint, compile, then every CI job this branch triggers
bun run prepush --dry-run  # print the plan only
bun run prepush --all      # every check, regardless of changed files
```

`prepush` diffs committed, staged, unstaged, and untracked files against the merge-base
with `origin/master`. It applies the CircleCI path-filter mapping in
`.circleci/config.yml`, then runs the local command for each triggered job: package
`test:coverage` plus the 90% new-file LCOV gate, `ui` types, demo typecheck,
example-backend and example-frontend tests, every `repo-policies` step, rulesync drift,
and the typedoc API reference when `api/src` or `rtk/src` changes. Every step runs even
after a failure, so a single pass lists every problem. Fix them all, then push once.

Jobs that need infrastructure (Playwright e2e, Maestro, admin-spa integration, Docker)
are listed at the end with the command to run by hand. A test in
`scripts/ci/prepush/plan.test.ts` fails when the mapping gains a parameter that
`prepush` neither runs nor lists.

## Package tests

From the repo root after `bun bootstrap`:

```bash
bun run test          # every workspace `test:ci`
bun run test:agent    # same suites; passing cases suppressed
```

Closest package during a red/green cycle:

```bash
bun test --only-failures <path>
```

| CircleCI job | Local command |
| --- | --- |
| `api-ci` | `bun run api:test` |
| `ai-ci` | `cd ai && bun run test:ci` |
| `ui-ci` | `bun run ui:test` |
| `rtk-ci` | `bun run rtk:test` |
| `syncdb-ci` | `bun run syncdb:test` |
| `comms-ci` | `bun run comms:test` |
| `jobs-ci` / jobs package | `bun run jobs:test` |
| `mcp-server-ci` | `cd mcp-server && bun run test:ci` |
| `create-terreno-app-ci` | `cd create-terreno-app && bun run test:ci` |
| `packages-ci` (`admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `test`) | `cd <package> && bun run test:ci` |
| `example-backend-ci` | `cd example-backend && bun run test:ci` |
| `example-frontend-ci` | `bun run frontend:test` |
| `ui-demo-ci` | `cd demo && bun run test:ci` then `bun run check:demo-coverage` |
| `new-file-coverage` | `bun run check:new-file-coverage --base=origin/master --threshold=90` |
| `repo-policies` | `bun run prepush` (runs every repo-policies step) |

Coverage gate for a published package: `cd <package> && bun run test:coverage`.

## Playwright (example-frontend e2e)

1. Install Chromium once: `cd example-frontend && bunx playwright install --with-deps chromium`
2. Start a replica-set `mongod` on `127.0.0.1:27017` (Cursor Cloud steps in AGENTS.md).
3. Re-run one failed spec (Playwright starts backend + web if they are not up):

```bash
cd example-frontend
MONGO_URI="mongodb://127.0.0.1:27017/terreno-e2e?replicaSet=rs0" \
  bunx playwright test e2e/<spec>.spec.ts --reporter=list
```

| CircleCI shard | Specs |
| --- | --- |
| `e2e` `auth` | `login` `signup` `consents` `forgot-password` `reset-password` `verify-email` |
| `e2e` `app` | `todos` `profile` `realtime` `ai-chat` `pdf` |
| `e2e` `admin-core` | `admin` `admin-home` `admin-form` `admin-todo-crud` `admin-title-update-depth` |
| `e2e` `admin-table` | `admin-table-search-filter` `admin-table-bulk-actions` `admin-custom-screens` `admin-comms-back` |
| `e2e` `syncdb` | `syncdb-load-delta` `syncdb-offline` `syncdb-conflicts` `syncdb-storage` `syncdb-chaos` |

Full local suite: `bun run frontend:e2e`. Nightly load (`e2e-load` / `syncdb-loadlab`) is
not PR-blocking; run `bunx playwright test e2e/syncdb-loadlab.spec.ts` only when that job
failed.

CircleCI skips a shard no changed file can reach. Ask for the same verdict before
pushing with `bun run check:e2e-affected` (see
[the affected gate](circleci.md#e2e-affected-gate)).

## Admin SPA

```bash
cd admin-spa
bun run test:ci
bunx playwright install --with-deps chromium
bun run test:e2e
bun run test:integration    # needs Mongo + example-backend; job `admin-spa-integration`
```

## Maestro web e2e

Install CLI if missing: `curl -fsSL "https://get.maestro.mobile.dev" | bash`, then put
`$HOME/.maestro/bin` on `PATH`.

```bash
bun run maestro:test
```

Demo-only flows: `bun run demo:maestro:test`. Job `maestro-e2e` uses a static web export
plus replica-set Mongo; local Maestro talks to the running example-frontend on 8082.

## Taste mapping

When CircleCI names a failed test, copy the file/case from the log and run the matching
row above. Record that command in Taste `checks.ev`. Re-run it after the fix and before
`git push`. `bun run prepush` does not replace that re-verify.

Appium Android/iOS is not in CircleCI (Maestro web covers those flows).
