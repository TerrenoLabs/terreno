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
and the typedoc API reference when `api/src` changes. Every step runs even
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
| `blocks-ci` | `bun run blocks:test` |
| `ui-ci` | `bun run ui:test` |
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
| `e2e` `auth` | `login` `signup` `consents` `forgot-password` `reset-password` `verify-email` `two-factor` |
| `e2e` `app` | `todos` `todo-windows` `todo-browser` `profile` `realtime` `ai-chat` `pdf` `notifications` `socket-flags` `mcp-tokens` |
| `e2e` `admin-core` | `admin` `admin-home` `admin-form` `admin-todo-crud` `admin-title-update-depth` `org-admin-security` `admin-user-security` |
| `e2e-cross-site` (not required) | the cross-site specs below, then `account-linking` with `E2E_ACCOUNT_LINKING=explicit` |
| `e2e` `admin-table` | `admin-table-search-filter` `admin-table-bulk-actions` `admin-custom-screens` `admin-comms-back` `harness-approvals` `harness-intake` |
| `e2e` `syncdb` | `syncdb-load-delta` `syncdb-offline` `syncdb-conflicts` `syncdb-storage` `syncdb-chaos` |

Full local suite: `bun run frontend:e2e`. Nightly load (`e2e-load` / `syncdb-loadlab`) is
not PR-blocking; run `bunx playwright test e2e/syncdb-loadlab.spec.ts` only when that job
failed.

The cross-site specs (`CROSS_SITE_SPEC_FILES` in `playwright.config.ts`:
`e2e/crossSiteBearer.spec.ts`, `e2e/crossSiteOAuth.spec.ts`, `e2e/authMethods.spec.ts`,
`e2e/crossSiteChallenges.spec.ts`, `e2e/crossSiteLogin.spec.ts`,
`e2e/account-linking.spec.ts`, `e2e/account-security.spec.ts`) run in CircleCI's `e2e-cross-site` job, which is not a required
check, rather than in an `e2e` shard: they need
a web server built with `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000` and
`EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true`, a backend with
`BETTER_AUTH_URL=http://127.0.0.1:4000`, `BETTER_AUTH_OAUTH_HANDOFF=true` and
`MOCK_OIDC_ISSUER` (the login page shows the mock provider's button because
`/api/auth/terreno/methods` then lists `mock-oidc`), and the mock OIDC provider on
`127.0.0.1:4555`. Naming any of those spec files (or
setting `E2E_CROSS_SITE_BEARER=true`) makes `playwright.config.ts` start all three and run only
the cross-site specs, so stop any other backend on 4000 and web server on 8082 first:
`cd example-frontend && E2E_CROSS_SITE_BEARER=true bunx playwright test`. CI serves a static
export instead of a Metro dev server, which gets OOM-killed bundling beside the backend and
Chromium. To run the specs exactly as `e2e-cross-site` does:

```bash
cd example-frontend
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true \
  bun expo export --platform web --output-dir dist-cross-site --clear
bunx serve dist-cross-site -s -l 8082 &
CI=true E2E_CROSS_SITE_BEARER=true MONGO_URI="mongodb://127.0.0.1:27017/terreno-e2e?replicaSet=rs0" \
  bunx playwright test --config playwright.circleci.config.ts --reporter=list
```

`--clear` matters: Metro's cache keeps the `EXPO_PUBLIC_*` values of an earlier export. A new
spec that needs
the mock provider or cookie-less sessions joins `CROSS_SITE_SPEC_FILES` and the
`cross-site-bearer` shard in `scripts/ci/e2eAffected/shards.ts`.

`e2e/account-linking.spec.ts` has cases for the backend's `explicit` linking mode, which skip
unless the backend reports that mode. `E2E_ACCOUNT_LINKING=explicit` starts the backend with
`AUTH_ACCOUNT_LINKING=explicit`; run that spec alone, because the other specs expect the default
`verified-email` (`e2e-cross-site` does this as its second step):
`cd example-frontend && E2E_ACCOUNT_LINKING=explicit bunx playwright test e2e/account-linking.spec.ts`.

### Deployed bearer smoke (`deploy-frontend-preview`)

`netlify-deploy.sh frontend` builds the web app with `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true`
for production and previews. After the preview deploy, the `deploy-frontend-preview` job's
"Smoke the deployed preview in web bearer mode" step runs `bun run smoke:deployed`
(`playwright.smoke.config.ts`, `e2e/deployedBearer.smoke.ts`) against
`https://pr-<n>--terreno-frontend.netlify.app`. It signs up a new `smoke-*@example.com` user on
the PR's own backend, agrees to the consent forms, reloads, opens the profile, and fails if the
API's origin holds a Better Auth session cookie. It also checks that the Google button's OAuth
handoff start link redirects (to the provider, or back to `/login?error=provider_not_found`)
instead of returning 404; `gcp-deploy.sh` sets `BETTER_AUTH_OAUTH_HANDOFF=true` on both backends.
Production deploys never run it. To re-run it:

1. Against the PR preview, which takes about 1 minute:

   ```bash
   cd example-frontend
   SMOKE_BASE_URL=https://pr-<n>--terreno-frontend.netlify.app \
     SMOKE_API_URL=https://pr-<n>---terreno-backend-example-7knxlrnpqq-uc.a.run.app \
     bun run smoke:deployed
   ```

2. Against a local cross-site stack, which takes about 5 minutes because of the web export.
   Start the backend with Better Auth on `127.0.0.1:4000`, then build and serve the web app
   with the flag on `localhost:8082` (a different site):

   ```bash
   # Terminal 1, from example-backend/ (the replica-set mongod from step 2 above)
   AUTH_PROVIDER=better-auth BETTER_AUTH_URL=http://127.0.0.1:4000 PORT=4000 \
     BETTER_AUTH_OAUTH_HANDOFF=true \
     MONGO_URI="mongodb://127.0.0.1:27017/terreno-smoke?replicaSet=rs0" \
     TOKEN_SECRET=dev TOKEN_ISSUER=dev REFRESH_TOKEN_SECRET=dev SESSION_SECRET=dev \
     bun run src/index.ts
   # Terminal 2, from example-frontend/. --clear: Metro's cache can keep an earlier
   # build's EXPO_PUBLIC_* values.
   EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true \
     bun run export --clear && bunx serve dist -s -l 8082
   # Terminal 3, from example-frontend/
   SMOKE_BASE_URL=http://localhost:8082 bun run smoke:deployed
   ```

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
