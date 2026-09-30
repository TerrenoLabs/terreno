# CircleCI (Terreno)

CircleCI CI/CD source of truth. See
[`docs/implementationPlans/migrate-cicd-to-circleci.md`](../implementationPlans/migrate-cicd-to-circleci.md).

**Status:** CircleCI owns package CI, repo policies, Playwright e2e, Maestro web
e2e, architectural PR review, semver-tag npm releases, and all continuous
deploys (Netlify demo / example frontend / docs, GCP terraform, Cloud Run
backend + tasks, MCP). The GitHub Actions deploy workflows are disabled and
kept only for rollback. CircleCI deploy jobs **fail** when `terreno-netlify`
or `terreno-gcp` is missing a value; they never skip green. GitHub-native
security, Cursor GitHub App checks (Approval / Security / Bugbot), and
repository automation remain enabled. EAS PR updates and the fingerprint gate
are temporarily disabled; manual EAS development dispatch remains available in
CircleCI. Preview **cleanup** on PR close is a thin GitHub
`preview-cleanup.yml` hook that starts a CircleCI `run-preview-cleanup`
pipeline.

## Project setup (maintainers)

1. Link `TerrenoLabs/terreno` in CircleCI (GitHub App).
2. Default branch: `master`.
3. Enable **dynamic config** / setup workflows for the project (required for
   `.circleci/config.yml` `setup: true`).
4. Create the contexts below (`terreno-netlify`, `terreno-gcp`, and the rest).
   Copy Netlify and GCP values from GitHub Actions secrets/vars. CircleCI is
   the only deployer, so deploy jobs fail until these are set.
5. Set project Environment Variable `CODECOV_TOKEN` (Codecov upload token) so
   package CI can upload `coverage/lcov.info`. Uploads skip when it is unset.
   Mirror the same secret as GitHub Actions `CODECOV_TOKEN` for retained twins.
   Public repos need a token unless the Codecov org disables token auth for
   public repositories.
6. Build forked PRs if you want DCO + rulesync on forks.

GitHub App org/project slug (API and CLI):
`circleci/6UHiK7pThPXbhnNi3umQNe/LdjghuhydHjFMyFjcEXMA2`.

Do not query `gh/TerrenoLabs/terreno` — that slug returns `404 Project not found`.
Cloud agents use `CIRCLECI_TOKEN` (accepted alias of CircleCI's `CIRCLE_TOKEN`). Send
it as the `Circle-Token` header. Confirm with `GET https://circleci.com/api/v2/me`, then
list pipelines on the slug above.

## Config layout

| File | Role |
|------|------|
| `.circleci/config.yml` | Setup workflow + `path-filtering` (this is the live config) |
| `.circleci/continue-config.yml` | Real jobs/workflows gated by those params |

## Bun install is uncached

`install_bun_and_deps` runs `bun install --frozen-lockfile` with
`node/install-packages` `with-cache: false`. Do not restore `~/.bun/install/cache`.
Measured on CircleCI (pipeline 1968 miss, 1969 exact lockfile hit, branch
`chore/update-dependencies`):

| Path | Restore | `bun install` | Save | Restore + install |
| --- | --- | --- | --- | --- |
| Cold (cache miss) | ~0.3s | ~11–21s (2488 packages) | ~17s on one job; others skip | **~12–21s** |
| Warm (exact lockfile hit) | ~15–17s | ~6–7s | skip | **~21–24s** |
| Stale fallback hit | ~22–73s | ~8–9s | skip | **~30–81s** |

Cache restore costs more than it saves. First jobs on a branch miss because
`include-branch-in-cache-key` was true. Parallel jobs cannot reuse a cache
saved later in the same pipeline. GitHub Actions twins use
`.github/actions/setup-bun-workspace` the same way (Bun pin + install, no
package cache). Keep Playwright, Docusaurus, and fingerprint caches.

Fork-only `dco` and PR `architectural-pr-review` always start on continuation
(review skips before checkout when the agentic/GitHub contexts are empty).
`rulesync-check` runs only when generated-rule sources change (`run-rulesync`).
`admin-backend/**` and `admin-frontend/**` start `packages-ci` (lint, compile,
`test:coverage`). Dedicated `admin-*-ci` job definitions stay in the config as
the same command sequence.

`.circleci/**` sets `run-circleci-config`. On **config-only** PRs that workflow
runs a representative slice (`api-ci`, `ui-ci`, `example-backend-ci`, `e2e`
shard `auth`). `repo-policies` still starts from `run-repo-policies` (also set
for `.circleci/**`); the kitchen-sink does not start a second copy. If the same
pipeline already set `run-api`, `run-ui`, `run-e2e`, `run-example-backend`, or
`run-admin-spa`, that kitchen-sink workflow is skipped so jobs are not doubled.
`comms/**` also sets `run-example-backend` and `run-example-backend-script`,
matching the GitHub Actions twins. `blocks/**` sets `run-blocks` plus every
parameter `ai/**` sets, because `@terreno/ai` depends on `@terreno/blocks`.

The example-backend Docker job runs only when its image recipe changes
(`Dockerfile`, `.dockerignore`, package manifests, or `bun.lock`). API/source
changes are covered by preview CD builds and do not start a duplicate image job.

UI, RTK, and admin-frontend changes do **not** start `example-backend-ci`.
Those packages are covered by `ui-ci` / `rtk-ci` / `packages-ci` plus e2e and
admin-spa. `new-file-coverage` starts on package `src/` (and example app
runtime paths including `example-frontend/components/`), not on every `*.ts`
file in the repo (Playwright specs no longer compile the world). Package CI
jobs that already ran `test:coverage` evaluate the 90% new-file gate against
that LCOV (`scripts/ci/check-new-file-coverage-lcov.sh`). Retained GitHub
Actions twins run that script with `working-directory: .` so a package-level
`defaults.run` cwd cannot nest `{package}/coverage/lcov.info`. GHA
`upload-codecov` steps pass `token: ${{ secrets.CODECOV_TOKEN }}`. The dedicated
`new-file-coverage` job skips those packages and only reruns tests for
workspaces without a coverage job in the same pipeline (example apps). Reruns
prefer colocated `*.test.ts` files and compile `@terreno/*` dist deps only
when the package imports them. Coverage-script unit tests run in the cheap
`coverage-scripts` job.

Playwright runs five shards after `e2e-prepare` (`auth`, `app`, `admin-core`,
`admin-table`, `syncdb`) instead of one container per spec file. Each shard
first checks the [affected gate](#e2e-affected-gate) and halts when no changed
file can reach it. Repository
policy checks share one `repo-policies` job so eight small checkouts do not
sit in the concurrency queue. `repo-policies` uses Node 22.14 because Knip's
oxc-parser throws `ERR_REQUIRE_ESM` on the shared 22.11 executor.
Require `repo-policies` in branch protection. Require `e2e-auth` /
`e2e-app` / … only as path-filtered checks; config-only PRs post `e2e-auth`
as the smoke shard and do not run the other four. Do not require the old
`no-barrel-imports` / `e2e-login` names.

## E2E affected gate

Path filters decide whether e2e is a *candidate*; `scripts/ci/e2eAffected`
decides which shards actually run. `e2e-prepare` runs

```bash
bun run check:e2e-affected --base origin/master --write e2e-affected.json
```

and persists the decision to the workspace (also stored as the
`e2e-affected.json` artifact). Each shard reads it and calls
`circleci-agent step halt` before `bun install` when it is unaffected, so an
unneeded shard costs one container start instead of a full Playwright run.
Run the same command locally to see what a branch would trigger.

`e2e-prepare` always runs when a path filter starts the workflow: compiling the
workspace and `bun expo export`ing the web bundle is the check that catches
build breakage the shards would otherwise miss.

The gate **fails open** — it runs every shard when the base revision cannot be
resolved, when a module cannot be resolved, or when the analysis throws. A
change is only skipped when it is provably outside a shard's surface:

| Change | Decision |
| --- | --- |
| Module reachable from the shard's screens, specs, or `example-backend/src` | run |
| Module nothing reachable imports (`ui/src/Avatar.tsx` today) | skip |
| Type-only edit to a reachable module (interfaces, `type`, `declare`) | skip |
| New export or lazy registry entry no consumer imports | skip |
| Re-export barrel that repoints a binding the app imports | run |
| `bun.lock` install the app resolves changing version | run |
| `bun.lock` or `package.json` churn outside that closure | skip |
| Docs, rules, `demo/**`, `scripts/**`, unit tests, snapshots, lint config | skip |
| Anything else (`metro.config.js`, `app.json`, `.circleci/**`, patches) | run |

Shard membership comes from `scripts/ci/e2eAffected/shards.ts`, which must
mirror the spec groups in `run_example_frontend_e2e`. `shards.test.ts` fails
when the two drift, when a spec is unassigned, or when a spec navigates to a
screen its shard does not declare. It also asserts that `ui/src/index.tsx`
stays a pass-through barrel — runtime code there would make every
`@terreno/ui` change look reachable.

## Automatic deploys

Path filters set `run-deploy-*` and `run-cd-*`. Production jobs run only on
`master`. Preview jobs run on PRs from this repository and skip forks and
non-PR branch builds.

| Path (examples) | Parameter | PR job | `master` job |
| --- | --- | --- | --- |
| `demo/**`, `ui/**` | `run-deploy-demo` | `deploy-demo-preview` | `deploy-demo` |
| `example-frontend/**`, `admin-frontend/**`, `rtk/**`, `ui/**`, `ai/**`, `blocks/**`, `syncdb/**`, `bun.lock` | `run-deploy-frontend` | `deploy-frontend-preview` | `deploy-frontend` |
| `docs/**`, `website/**` | `run-deploy-docs` | `deploy-docs-preview` | `deploy-docs` |
| `example-backend/**`, `api/**`, `comms/**`, `jobs/**`, `admin-spa/**`, `feature-flags/**`, `announcements/**`, plus every frontend path above | `run-cd-backend` | `gcp-cd-preview` | `gcp-cd-prod` |
| `terraform/**` | `run-cd-terraform` | `gcp-cd-preview` | `gcp-cd-prod` |
| `mcp-server/**`, `ui/**` | `run-cd-mcp` | _(none)_ | `gcp-cd-prod` (runs `mcp-server` `test:ci` first) |

The backend image bundles the admin SPA (ui, rtk, admin-frontend, syncdb), so
those paths redeploy the backend too. Every frontend PR preview therefore gets
an isolated `pr-N` backend: `deploy-frontend-preview` always points
`EXPO_PUBLIC_API_URL` at it (the prod backend rejects preview CORS) and waits
up to 20 minutes for its `/health` before publishing, because `gcp-cd-preview`
runs in a separate workflow.

Backend previews prune not-Ready tagged revisions from traffic
(`rebuild-cloud-run-ready-traffic.sh`), deploy untagged with
`--revision-suffix`, then point the `pr-N` tag at that revision. Terraform
preview always describes the Infra Manager preview (state, `errorCode`,
`errorLogs`) before delete, including when `previews create` fails. Fork PRs
still present `repository: TerrenoLabs/terreno` on the OIDC token, so WIF
would accept them if those jobs ran. Preview jobs halt on fork PRs, where CircleCI withholds contexts.
GitHub App builds do not set `CIRCLE_PR_USERNAME` / `CIRCLE_PR_REPONAME`;
`skip_if_fork_deploy` asks the pulls API and halts before
`require_*_context` would fail on those withheld secrets.

### GitHub Deployment records

Deploy scripts wrap the publish step in `with_github_deployment`
(`scripts/ci/github-deployment-lib.sh`): the deployment is created as
`in_progress` with the CircleCI job as `log_url`, then set to `success`
(with the environment URL) or `failure`. PR previews are transient; the rest
are production environments. Environment names match the retired GitHub
workflows, so history stays continuous:

| Job | Environment | URL |
| --- | --- | --- |
| `deploy-demo` / `deploy-demo-preview` | `demo` / `demo-preview-pr-N` | `terreno-demo.netlify.app` / `pr-N--terreno-demo.netlify.app` |
| `deploy-frontend` / `deploy-frontend-preview` | `example-frontend` / `example-frontend-preview-pr-N` | `terreno-frontend.netlify.app` / `pr-N--terreno-frontend.netlify.app` |
| `deploy-docs` / `deploy-docs-preview` | `docs` / `docs-preview-pr-N` | `terreno-docs.netlify.app` / `docs-pr-N--terreno-docs.netlify.app` |
| `gcp-cd-prod` backend / `gcp-cd-preview` | `example-backend-production` / `example-backend-preview-pr-N` | Cloud Run URL / `pr-N---` tag URL |
| `gcp-cd-prod` MCP | `mcp-production` | Cloud Run `terreno-mcp` URL |

Records are posted to `GITHUB_REPOSITORY` when that is set, otherwise
`TerrenoLabs/terreno`. CircleCI does not set `GITHUB_REPOSITORY`, and
`CIRCLE_PROJECT_USERNAME` can still be the pre-transfer `FlourishHealth`
project link, so the script does not use it. Recording is best-effort: an
unset `GITHUB_DEPLOYMENTS_TOKEN` or a GitHub API error prints a warning and
never fails the deploy. Terraform applies are not recorded. PR close
deactivates the preview environments (`preview-cleanup.yml`). The token lives
in its own context so the GitHub write scope is limited to deployments.
Same-repo PR pipelines can read every context their jobs attach, so keep this
token scoped to deployments.

Each deploy job has a `serial-group`: production jobs queue per target, and
previews queue per branch, so two master merges never apply terraform or roll
Cloud Run at the same time. Turn off Netlify's GitHub auto-build so only
CircleCI publishes.

## Contexts (create empty shells, then fill)

Do **not** paste secret values into the repo. Create these CircleCI Contexts and
restrict `terreno-release` and `terreno-npm` to tag/manual release pipelines.

| Context | Maps from GHA | Used by (planned / current) |
|---------|---------------|------------------------------|
| `terreno-npm` | `NPM_TOKEN` | tag + manual package publishing |
| `terreno-netlify` | `NETLIFY_AUTH_TOKEN`, three `NETLIFY_*_SITE_ID` values | Netlify deploys |
| `terreno-expo` | `EXPO_TOKEN` | manual EAS workflows |
| `terreno-gcp` | `GCP_WIF_PROVIDER_PROD`, `GCP_TF_ADMIN_SA_PROD`, `GCP_CD_DEPLOYER_SA_PROD`, optional `GCP_INFRA_MANAGER_LOCATION`, `MCP_SENTRY_DSN` | GCP CD + cleanup |
| `terreno-e2e` | `E2E_TOKEN_SECRET`, `E2E_REFRESH_TOKEN_SECRET`, `E2E_SESSION_SECRET` | `e2e`, `admin-spa-integration`, `maestro-e2e` |
| `terreno-release` | `REPO_ADMIN_TOKEN`, `ZOOM_WEBHOOK_URL`, `ZOOM_WEBHOOK_TOKEN` | stable version bump + release notification |
| `terreno-agentic` | `CURSOR_API_KEY`, optional `CURSOR_MODEL` | `architectural-pr-review` |
| `terreno-github-api` | PAT (`pull-requests`, `contents`, …) | `dco`, `architectural-pr-review` |
| `terreno-github-deployments` | `GITHUB_DEPLOYMENTS_TOKEN`: fine-grained PAT on `TerrenoLabs/terreno` with **Deployments: read/write** and **Pull requests: read** only | GitHub Deployment records + preview PR lookup in every Netlify/GCP deploy job |

Until contexts exist, e2e jobs may use **project env vars for `E2E_*` secrets only**
(or the in-job `ci-e2e-*-secret` fallbacks). **Do not** put `GITHUB_TOKEN` (or any
GitHub PAT) in project env vars — those are injected into every job, including
`bun` scripts from the PR. Create `terreno-github-api`, restrict it to this
project, leave fork-PR secret passing off, and attach that context **only** to
`dco` and `architectural-pr-review`. DCO skips if `GITHUB_TOKEN` is unset.
`architectural-pr-review` also skips if `GITHUB_TOKEN` or `CURSOR_API_KEY` is
unset, and it skips fork PRs. The job checks out `origin/master` before running
the review script so a PR cannot rewrite the reviewer.

Netlify and GCP jobs **validate their context as the first step** and fail,
before checkout or `bun install`, listing the missing variables. Preview jobs
halt earlier on fork PRs, where CircleCI withholds contexts. Docker Layer
Caching is off (200 credits per job). The docs Netlify target disables
Docusaurus minification so the build stays within the 8 GB `large` executor.

`terreno-gcp` uses CircleCI OIDC (`CIRCLE_OIDC_TOKEN_V2`), never a JSON service
account key. Set `circleci_org_id`, `circleci_project_id`, and
`circleci_gcp_context_id` in `terraform/terraform.tfvars`, apply once with an
existing Terraform admin identity, then copy `circleci_workload_identity_provider`
into the context as `GCP_WIF_PROVIDER_PROD`. The WIF condition requires the
`terreno-gcp` context UUID so a PR job without that context cannot exchange the
ambient OIDC token for GCP impersonation.

## Check name map (GHA → CircleCI)

Branch protection must require the CircleCI job names below. Remove disabled
GitHub check names or pull requests will wait for checks that can no longer run.

Dedicated package jobs (`api-ci`, `ai-ci`, `blocks-ci`, `rtk-ci`, `ui-ci`, `syncdb-ci`,
`comms-ci`, `mcp-server-ci`, `admin-spa-ci`) run `bun run test:coverage`
(`scripts/check-coverage.ts`, 95% functions and lines). Isolated `syncdb` tests
are included by that script. Published packages without a dedicated workflow
(`admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `test`) run
the same commands through the parameterized `packages-ci` job, gated by
`run-admin-backend`, `run-admin-frontend`, `run-api-health`,
`run-feature-flags`, and `run-test-package`. The retained
`.github/workflows/packages-ci.yml` matrix twin stays `push.branches-ignore: ["**"]`.

| GHA job `name:` / workflow | CircleCI job |
|----------------------------|--------------|
| Repository policies (barrels, source rules, explicit any, licenses, changelog, parity, lifecycle, static analysis) | `repo-policies` |
| Verify rules are in sync | `rulesync-check` |
| `dco` | `dco` |
| Run all tests (API CI) | `api-ci` |
| Admin backend lint, compile, coverage | `packages-ci` (`admin-backend`) |
| Admin frontend lint, compile, coverage | `packages-ci` (`admin-frontend`) |
| Run all tests (AI CI) | `ai-ci` |
| Lint, compile, and test blocks | `blocks-ci` |
| RTK Lint and Build | `rtk-ci` |
| Syncdb Lint, Build, and Tests | `syncdb-ci` |
| UI Lint, Build, Types, and Tests + demo typecheck | `ui-ci` |
| Demo Lint and TypeScript Check | `ui-demo-ci` (demo-only PRs) |
| Lint, compile, and test communications | `comms-ci` |
| Lint, Build, and Test (MCP) | `mcp-server-ci` |
| Lint, compile, and coverage (create-terreno-app) | `create-terreno-app-ci` |
| Build Docker Image (MCP) | `mcp-server-docker` |
| Example Frontend Lint and Test | `example-frontend-ci` |
| Example Backend lint/test + admin script CLI | `example-backend-ci` |
| Run admin script CLI (when backend CI did not already run) | `example-backend-script-runner` |
| Build backend Docker image | `example-backend-docker` |
| Admin SPA Build and E2E | `admin-spa-ci` |
| Lint, compile, and coverage (matrix package) | `packages-ci` (`admin-backend`, `admin-frontend`, `api-health`, `feature-flags`, `test`) |
| E2E · `<shard>` | `e2e` (matrix `shard`: `auth`, `app`, `admin-core`, `admin-table`, `syncdb`) |
| E2E Load · syncdb-loadlab | `e2e-load` (trigger-gated, see below) |
| Admin SPA Backend Integration E2E | `admin-spa-integration` |
| _(e2e compile+export once)_ | `e2e-prepare` |
| Architectural PR review | `architectural-pr-review` (non-blocking; skip forks / missing secrets) |
| Maestro E2E Tests | `maestro-e2e` (`include-demo` when ui/demo Maestro flows change) |
| New file coverage | `new-file-coverage` |
| Coverage gate scripts | `coverage-scripts` |
| Netlify production | `deploy-demo`, `deploy-frontend`, `deploy-docs` |
| Netlify PR preview | `deploy-demo-preview`, `deploy-frontend-preview`, `deploy-docs-preview` |
| GCP production | `gcp-cd-prod` |
| GCP PR preview | `gcp-cd-preview` |
| npm semver tag | `publish-release` |

CD replacement map:

| GHA job `name:` / workflow | CircleCI job |
|---------------------------------------------|----------------------|
| Fingerprint gate (`fingerprint-gate.yml`) | Temporarily disabled; no CircleCI automatic gate |
| EAS PR update/build (`eas-pr.yml`) | Temporarily disabled; use manual EAS dispatch |
| EAS dev build (`eas-dev-build.yml`) | CircleCI manual `eas-dev-target` |
| CD terraform / Cloud Run (`cd.yml`) | `gcp-cd-prod` (master) and `gcp-cd-preview` (PRs) |
| Preview cleanup (`preview-cleanup.yml`) | `preview-cleanup`, started by the GitHub PR-close hook |
| Netlify demo / frontend / docs deploys | production + `*-preview` jobs |
| Publish on tag (`publish-on-tag.yml`) | `publish-release` |
| Appium Android / iOS | Not ported (Maestro web is `maestro-e2e`) |

## Manual pipelines

Trigger a pipeline from the CircleCI UI/API on the ref containing the code to
operate. Set exactly one operation per pipeline.

Netlify and GCP operations require the contexts in the table above. Path filters
start production deploys on `master` and PR previews on other branches
automatically. Use the manual parameters to force a deploy or to clean up after
a closed PR.

| Operation | Pipeline parameters |
|-----------|---------------------|
| Force all GCP production CD (use `master`) | `{"run-cd":true}` |
| Force demo production deploy | `{"run-demo-deploy":true}` |
| Deploy backend + Netlify previews | `{"deploy-preview-pr":"1199"}` |
| Remove preview backend tag/database | `{"run-preview-cleanup":"1199"}` |
| Dispatch EAS development builds | `{"eas-dev-target":"both"}` (`example-frontend`, `demo`, or `both`) |
| Publish one package | `{"manual-publish-package":"syncdb","manual-publish-version":"57.3.0"}` |
| Run load test | `{"run-e2e-load":true}` |

`manual-publish-package` also accepts `feature-flags`. Versions must be semver.
Semver git tags (`57.3.0`, `57.3.0-beta.1`) automatically start
`publish-release`; prereleases publish to their prerelease npm dist-tag.
`publish-release` compiles the 16 lockstep packages once with
`bun run --filter ... compile` (dependency order), then runs
`scripts/ci/publish-package.sh` for all of them in parallel with
`TERRENO_PUBLISH_PREBUILT=1`. It does not rerun tests: the tagged commit
already passed CI on master, and rerunning every suite per package made
releases take 20+ minutes. The job has no Mongo sidecar. Each publish writes
its own temporary npmrc (`NPM_CONFIG_USERCONFIG`) so parallel publishes do not
remove each other's token.

`publish-package.sh` pins `workspace:*` to the tag version for the tarball.
It must not `bun install` after that pin: sibling `@terreno/*` packages are
not on npm yet, so bun would look up `@terreno/test@X.Y.Z` (and similar) on
the registry and fail the whole job. Without `TERRENO_PUBLISH_PREBUILT` (the
manual single-package publish), it compiles the package and its workspace
dependencies and runs `test:ci` when that script exists, not `test`.
`@terreno/ui`'s `test` is `bun test --watch` and would hang. If a package's
tag version is already on npm, `publish-package.sh` skips it so a recut of
the same tag can finish the rest.

Only stable tags (`57.3.0`) run `deploy-demo`. It builds the demo from source,
so it runs alongside `publish-release` instead of waiting for it. Use
`{"run-demo-deploy":true}` on `master` if a prerelease must also refresh the
demo site.

`scripts/ci/netlify-deploy.sh` builds each site itself and calls
`netlify deploy --no-build`. Without `--no-build`, netlify-cli runs the root
`netlify.toml` docs build (wipe `node_modules`, reinstall, full Docusaurus),
which added about 3.5 minutes to every demo and frontend deploy.

CircleCI does not receive GitHub `pull_request.closed` events, so
`.github/workflows/preview-cleanup.yml` forwards them: it runs master's
`scripts/ci/trigger-circleci-pipeline.sh` with `{"run-preview-cleanup":"<PR>"}`
and deactivates the PR's old GitHub Deployments. The manual GHA publisher
(`publish-on-tag.yml`) uses the same script to start `{"run-demo-deploy":true}`
on `master`. Both need the GitHub secret `CIRCLECI_TOKEN` (a CircleCI personal
or project API token) and the repository variable
`CIRCLECI_PIPELINE_DEFINITION_ID` (Project Settings → Pipelines, or
`GET /api/v2/projects/<project id>/pipeline-definitions`; the project id comes from
`GET /api/v2/project/<slug>`). Set the
optional variable `CIRCLECI_PROJECT_SLUG` if re-linking the project changes
its slug. Path-filtered
preview **deploys** run on open PRs from this repository; fork PRs are skipped.
If `CIRCLE_PULL_REQUEST` is unset (GitHub App `push` pipelines), the job looks
up the open PR for `CIRCLE_BRANCH` via the GitHub API on `TerrenoLabs/terreno`
(`GITHUB_REPOSITORY` when set). It does not use `CIRCLE_PROJECT_USERNAME`,
which can still be the pre-transfer `FlourishHealth` project link.

`mcp-server-docker` is push-only, matching GitHub Actions. It uses
`resolve-preview-pr.sh` for that lookup and skips when a PR exists. Its
production `bun install` passes `--ignore-scripts`: root `prepare` runs
`simple-git-hooks`, which is a devDependency and is missing from a production
tree.

## Path-filter parity guard

`bun run check:circleci-parity` guards active GitHub/CircleCI twins. Deploy
workflows are disabled on GitHub, so they are not in the parity mapping. New CircleCI-only path rules still belong in
`.circleci/config.yml` and config tests. The checker prefers live `config.yml`
when `setup: true`.

## Config-only changes

Edits to `.circleci/config.yml` / `continue-config.yml` /
`example-frontend/playwright.circleci.config.ts` set `run-circleci-config`.
When no package/e2e path param is also set, that workflow runs the slice above.
CircleCI e2e compiles the workspace and `bun expo export`s **once** in
`e2e-prepare` (`large`, 8 GB — the export heap is 3 GB). Five shards then
attach that dist on `medium+` (6 GB, 15 credits/min). `xlarge` is not on this project's plan. In-job
compile+export jobs (`maestro-e2e`, `admin-spa-integration`, `e2e-load`) stay
on `large`. Chaos e2e treats a hidden Offline banner after `goOnline` as
reconnect — a `client.stop()`/`start()` handshake hung 30s on the static
export. `maestro-e2e` follows the same static-export rule: it exports
example-frontend and serves the static `dist`. If the browsers image has no
Xvfb on `:99`, a `background: true` fallback starts one and keeps it alive
for later steps.

Package jobs that only lint/compile/test one workspace package stay on
`medium` (including `mcp-server-ci`, `example-backend-ci`, and
`new-file-coverage`). `coverage-scripts` is `small`. Do not put Docker Layer Caching on remote-docker jobs
unless a profiled image build reuses layers enough to beat 200 credits/run.

## Nightly load test

`e2e-load` (syncdb-loadlab) is never PR-blocking. Trigger the **setup** pipeline
with `run-e2e-load`. Setup skips path-filtering and continues with a differently
named continuation parameter (`e2e-load`) so CircleCI does not report conflicting
pipeline parameters.

```json
{"run-e2e-load": true}
```

This replaces the GHA cron / `workflow_dispatch` / `load-test` label triggers in
`e2e-load-nightly.yml`. Create a CircleCI schedule with
`{"run-e2e-load":true}` at `0 6 * * *` to retain the nightly run.

## Local validation

Map every CircleCI test job to a local command with
[run tests locally](run-tests-locally.md). Config syntax:

```bash
circleci config validate .circleci/config.yml
circleci config validate .circleci/continue-config.yml
```

## Disabled GitHub workflows

Package CI, e2e, npm tag, and deploy workflows (`docs-deploy.yml`,
`demo-deploy.yml`, `frontend-example-deploy.yml`, `cd.yml`) stay
`push.branches-ignore: ["**"]` for rollback. `preview-cleanup.yml` stays live
only as the PR-close trigger. Never enable both npm tag publishers. Never
re-enable `cd.yml` while CircleCI deploys: both would apply terraform.

## Cursor GitHub App checks

Do not try to run these on CircleCI. They are Cursor-hosted GitHub App
automations (dashboard / GitHub App), not workflow files in this repo:

| Check | Why it stays on GitHub |
| --- | --- |
| Cursor Approval Agent: Pull Request Approver | Cursor cloud agent; posts its own GitHub check |
| Cursor Security Agent: Security Reviewer | Same Cursor GitHub App path |
| Cursor Bugbot | Same Cursor GitHub App path |

The in-repo architectural reviewer (`cursor-agent` CLI +
`.github/scripts/architectural-pr-review.ts`) is the job that *can* move, and it
now runs on CircleCI.

## Not in this phase

- Appium (Android emulator / iOS simulator)
- CodeQL, Dependabot auto-merge, triage, gh-aw lockfile agentics
- EAS PR updates and fingerprint acknowledgement
- Cursor Approval / Security / Bugbot GitHub App checks
