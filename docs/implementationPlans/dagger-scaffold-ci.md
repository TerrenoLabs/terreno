# Dagger CI for scaffolded Terreno apps

Terreno's own CI is CircleCI, and apps made by `create-terreno-app` get two GitHub Actions
workflows that repeat the same lint, compile, and test steps inline. That means CI logic is
copied into every app, only runs on GitHub, and cannot be reproduced locally. This plan makes
each new app carry a small Dagger module that holds those steps, and generates a thin config
for the chosen CI host that just calls it. App authors and the agents that work on their
repos get one command that runs the same checks on a laptop, in hosted CI, and on a
self-hosted runner. Terreno's own CircleCI pipeline is not migrated, following your "maybe not terreno itself". You
asked for Dagger as the default, and decided it stays opt-in until measured: the spike proved Dagger
runs in hosted CI, not that it beats the inline steps, and the self-hosted warm-cache benefit was
never measured. Today's inline workflows stay the default until a speed comparison exists.

## The idea

`create-terreno-app` emits a root `dagger/` TypeScript module (Bun runtime) with five functions,
each installing and running inside its own `backend/` or `frontend/` directory because a
scaffolded app has no root workspace: `backendCheck` and `frontendCheck` (install, `bun run lint`,
`bun run compile`), and `backendTest` and `frontendTest` (install, `bun run test`; the backend one
binds a plain Mongo service). A new `--ci=inline|github|circleci|dagger|none` flag chooses what is
written: `inline` (the default) is today's workflows with no Dagger module; `github` and `circleci`
write the Dagger module plus a host config that calls it; `dagger` writes the module only; `none`
writes nothing. Host configs only install the pinned Dagger CLI and run
`dagger call`. Path filtering and secrets stay in the host config, so the `github` output stays two
workflows (backend and frontend), each filtering on its own directory plus `dagger/**`. Rejected
alternative: a shared published Dagger module, which adds a network dependency and a versioning
surface before the shape is proven.

## Spike findings

Source: branch `dagger` on TerrenoLabs/terreno (`dagger/src/index.ts`, commit "Add Dagger CI spike
for example-backend...") and CircleCI pipeline 908. This is a Terreno-monorepo module against
`example-backend`, not the scaffold shape.

- Local (Apple Silicon, Docker Desktop): cold compile about 90s, warm 5s; lint warm 7s; the full
  `example-backend` suite passed with a plain `mongo:6.0` service. Warm runs are Dagger cache hits,
  so they are not a speed comparison with the inline jobs.
- CircleCI pipeline 908: `dagger-machine` (machine executor) and `dagger-remote-docker`
  (Docker executor plus `setup_remote_docker`) both passed, about 4:00 and 3:54 total, cold.
  No per-step timings were retrievable.
- Not run: the self-hosted warm-engine test (the two local Docker contexts `flourish-worker` and
  `skybound-worker` timed out; this is unrelated to `setup_remote_docker`).
- A replica-set Mongo service reached primary but the `example-backend` suite then cascaded "Client must be connected" failures; the cause was not isolated (a crash-and-resume suite closes the shared connection), and plain Mongo plus a system `mongod` for suites that start their own replica set passed. T1 therefore re-proves the replica-set service on a scaffold-shaped app.
- Scaffold fact found while planning: a fresh app generates no test files, and `bun test` exits 1
  on zero tests, so today's generated backend and frontend workflows would fail on a new app.
  `bun test --pass-with-no-tests` exits 0.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Generated apps get a Dagger module; the `test` script passes with no tests (also fixes the inline default) | none | create-terreno-app | generator tests plus `dagger call` on a generated app |
| T2 | Scaffold smoke job in Terreno CI replaces the spike | T1 | .circleci, spike files | CircleCI amd64 run that generates an app and runs `dagger call` |
| T3 | `--ci` flag and host dispatcher | T1, T2 | create-terreno-app | parser and generator tests |
| T4 | GitHub Actions workflows call Dagger | T3 | create-terreno-app | generator tests plus `actionlint` |
| T5 | CircleCI config calls Dagger | T3 | create-terreno-app | generator tests plus `circleci config validate` |
| T6 | Docs: how-to, explanation, reference, scaffold guide | T4, T5 | docs | docs-audit plus docs-site build |

Tracer: T1 cuts through the whole seam: generator output, then a real `dagger call` against a
freshly generated app. T2 runs it on amd64 CI before the flag and host configs are built, so a
design problem surfaces early. Chain T1 to T2 to T3 to T4 is deliberate: T2 needs T1's module, T3
edits the same CircleCI file as T2 and reuses its smoke job, and T4 and T5 build on T3's dispatcher.
Out of scope: see Expansions. Self-hosted CI is a deliberate narrowing: v1 documents it and ships nothing generated or measured for it (D2).
Open risks: the replica-set service did not work cleanly in the spike's `example-backend` run and T1 must prove it on a scaffold-shaped app; speed versus the inline steps is unmeasured; the telemetry opt-out variable and the
"Dagger Cloud off by default" claim are confirmed against Dagger's docs in T1, and T1 stops if
they do not hold.

## Assumptions

- The default `--ci` is `inline` until the X2 speed comparison reports (D1). Flipping it is X7.
- IPs live in `docs/implementationPlans/` in this repo (existing convention), with the task list
  in this file. New tests go in `create-terreno-app/src/__tests__/`. The package `files` field
  ships `dist`, so new source files need no packaging change.
- Dagger CLI and engine are pinned to 0.21.11, the version the spike ran on. The `@dagger.io/dagger`
  SDK version, the Bun image tag, and the Mongo image tag are pinned too, and each pin has a test.
  Images are pinned by tag, not digest (Q8). The CLI is installed by downloading the pinned release tarball and verifying a SHA256 recorded in the generator (T1); the spike used the official install script, which has no checksum check.
- Install uses `bun install --frozen-lockfile` when the app has a `bun.lock`, and plain
  `bun install` when it does not (a fresh scaffold has none).
- The scaffold's `test` script changes to `bun test --pass-with-no-tests` in both `package.json`
  files, so a fresh app's local `bun run test` and the Dagger functions agree. Apps that add tests
  get a single-node `mongo:6.0` replica set bound as `mongo` for the backend (D3).
- The arm64 `mongod` download 403 seen in the spike is a local Apple Silicon problem. The
  generated module does not carry the `MONGOMS_SYSTEM_BINARY` workaround. T2's smoke job runs on
  CircleCI's amd64 executors and is the first real check of that.
- Dagger Cloud and trace upload are off unless a token is set. Generated configs never set a
  Dagger Cloud token and set the telemetry opt-out. Both are confirmed in T1.
- No Dagger function receives a secret in v1. Secrets stay in the host config; the docs say how to
  pass one later with `--secret`.
- Expo and EAS builds, Playwright, and path filtering stay in the host config, not Dagger.
- Hosted GitHub runners and `setup_remote_docker` start with an empty engine every run, so the
  generated configs lose the `actions/cache` Bun cache the inline workflows had. This is accepted
  and documented in T6.
- "Self-hosted" means a self-hosted GitHub Actions runner or a CircleCI self-hosted runner running
  a persistent Dagger engine. v1 documents both and ships no generated artifact for them (D2).

## Tasks

- [ ] **T1** — Generated apps get a Dagger module; the `test` script passes with no tests (also fixes the inline default)
  - Depends on: none
  - Files: create-terreno-app/src/generateDagger.ts, create-terreno-app/src/__tests__/generateDagger.test.ts, create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts
  - Criteria:
    - `generateAllFiles` emits `dagger.json`, `dagger/package.json` (Bun runtime, no `yarn.lock`), `dagger/tsconfig.json`, `dagger/.gitignore`, and `dagger/src/index.ts`. Verified by a generator test asserting each path and the Bun runtime setting.
    - The module exposes `backendCheck`, `frontendCheck`, `backendTest`, and `frontendTest`, with the steps in "The idea"; each runs inside its own app directory and uses `--frozen-lockfile` only when `bun.lock` exists. Verified by `generateDagger.test.ts` on the generated source, with and without a lockfile.
    - The generated `backend/package.json` and `frontend/package.json` `test` scripts are `bun test --pass-with-no-tests`, so the default `inline` output changes too. Verified by a generator test on default output, and by running `bun run test` in a generated app and getting exit 0.
    - `backendTest` binds a single-node Mongo replica set, waits until it is a writable primary before running tests, and sets `MONGO_URI` to reach it with `directConnection=true`, overriding the scaffold's `127.0.0.1` default; app-specific secrets stay in the host config. Verified by adding one throwaway test to a temp generated app (not generator output) that opens a change stream, and running it through `dagger call backend-test`.
    - Engine, SDK, Bun image, and Mongo image versions are pinned. Verified by a test asserting each pin.
    - Dagger's documentation confirms the telemetry opt-out variable and that traces go to Dagger Cloud only when a token or login is present; the generated module's docs comment names the variable. Verified by the doc links in the PR, a test asserting the variable name, and a `dagger call` run with the variable set whose output contains no Dagger Cloud trace-run URL. If the docs contradict either claim, stop and ask.
    - The SHA256 checksums of the pinned 0.21.11 CLI release tarballs (linux amd64 and arm64) are taken from Dagger's published release checksums and recorded in the generator. Verified by a link to the release checksums in the PR and a test asserting the values are present.
    - In a freshly generated app, `dagger call backend-check`, `frontend-check`, `backend-test`, and `frontend-test` all exit 0, proven on CircleCI amd64 by T2's smoke job (D4); no local `dagger call` run is required. This is the gate for T3. Verified by the green T2 pipeline run link in the PR.
  - Docs: none yet (T6)
  - Skills: terreno:update-docs
  - Note: T1 emits the module unconditionally; T3 gates it behind `--ci github|circleci|dagger`. T1 and T3 ship in the same PR so the default scaffold output never changes mid-way.

- [ ] **T2** — Scaffold smoke job in Terreno CI replaces the spike
  - Depends on: T1
  - Files: .circleci/config.yml, .circleci/continue-config.yml, knip.jsonc, dagger.json, dagger/package.json, dagger/tsconfig.json, dagger/.gitignore, dagger/.gitattributes, dagger/src/index.ts
  - Criteria:
    - The spike's root `dagger/` module, `dagger.json`, the `dagger-machine` and `dagger-remote-docker` jobs, the `run-dagger-spike` parameter, its path mapping, and the `dagger/**` knip ignore are deleted. Verified by grep returning nothing for those names.
    - A new CircleCI job generates an app with `create-terreno-app` into a temp directory, then runs `dagger call` for all four functions using that app's own generated module, and runs only on `create-terreno-app/**` changes. The job builds the package (`bun run --filter create-terreno-app compile`) and runs `bun create-terreno-app/dist/cli.js <name> --yes`; the generated app installs the published `@terreno/*` versions from npm, so unreleased changes to other packages are not exercised, and this limit is stated in the job's comment. T3 later adds `--ci dagger` to its generate command. Verified by a green amd64 pipeline on the branch with the job name and run link in the PR.
    - `circleci config validate`, `check-circleci-parity`, and `bun run analyze:full` pass. Verified by running each.
  - Docs: none
  - Skills: none

- [ ] **T3** — `--ci` flag and host dispatcher
  - Depends on: T1, T2
  - Files: create-terreno-app/src/writeScaffold.ts, create-terreno-app/src/generate.ts, create-terreno-app/src/generateCi.ts, create-terreno-app/src/generateCiInline.ts, create-terreno-app/src/generateCiGithub.ts, create-terreno-app/src/generateCiCircleci.ts, create-terreno-app/src/cli.ts, create-terreno-app/src/__tests__/cli.test.ts, create-terreno-app/src/__tests__/generate.test.ts, .circleci/continue-config.yml
  - Criteria:
    - `--ci inline|github|circleci|dagger|none` is parsed; the default is `inline`; any other value returns exit code 1 with a clear error. Verified by `cli.test.ts` cases for each value and an invalid one.
    - `inline` writes the same two workflows as today and no Dagger module, and the existing "generated CI installs before a lockfile exists" test still passes on them. Verified by that test and a generator test asserting no `dagger` paths.
    - `dagger` writes the module and no host config; `none` writes neither. Verified by generator tests for each value.
    - `generateCi.ts` dispatches to `generateCiInline.ts`, `generateCiGithub.ts`, or `generateCiCircleci.ts`; T3 creates all three, with `generateCiInline.ts` holding today's workflows and the other two returning an empty list, so T4 and T5 only edit their own host file. Verified by a generator test for each `ci` value.
    - The Dagger module is emitted only for `github`, `circleci`, and `dagger`. Verified by generator tests.
    - `BootstrapArgs.ci` flows from the parser to `generateAllFiles`, and T2's smoke job now generates with `--ci dagger` and stays green. Verified by a generator test and the smoke job's pipeline run.
  - Docs: none yet (T6)
  - Skills: none

- [ ] **T4** — GitHub Actions workflows call Dagger
  - Depends on: T3
  - Files: create-terreno-app/src/generateCiGithub.ts, create-terreno-app/src/__tests__/generateCiGithub.test.ts
  - Criteria:
    - `--ci github` writes two workflows, `backend-ci.yml` and `frontend-ci.yml`; each installs the pinned Dagger CLI by downloading the release tarball and verifying its recorded SHA256 (no install script), and runs its own check and test functions; no inline `bun install` steps remain. Verified by a test in `generateCiGithub.test.ts`.
    - Each workflow filters on its own directory plus `dagger/**`, so a `backend/**` change does not run the frontend job. Verified by a test asserting the `paths` lists.
    - Each workflow sets the telemetry opt-out and no Dagger Cloud token. Verified by a test.
    - The existing "generated CI installs before a lockfile exists" test still covers only the `inline` workflows; a new test covers `github`. Verified by both passing.
    - The workflows pass a pinned `actionlint` release (version and download URL recorded in the test helper). Verified by running it on the generated files.
  - Docs: none yet (T6)
  - Skills: none

- [ ] **T5** — CircleCI config calls Dagger
  - Depends on: T3
  - Files: create-terreno-app/src/generateCiCircleci.ts, create-terreno-app/src/__tests__/generateCiCircleci.test.ts
  - Criteria:
    - `--ci circleci` writes `.circleci/config.yml` using a Docker executor plus `setup_remote_docker`, with the same install (tarball plus SHA256 check) and `dagger call` steps as spike job `dagger-remote-docker`, whose passing run used the install script. Verified by a test asserting the executor, the remote-Docker step, and the commands.
    - The config validates. Verified by `circleci config validate` on the generated file, run locally or in T2's CircleCI job (the CircleCI CLI is already installed on this machine).
    - The config sets the telemetry opt-out and contains no Dagger Cloud token and no `machine` executor. Verified by a test.
  - Docs: none yet (T6)
  - Skills: none

- [ ] **T6** — Docs: how-to, explanation, reference, scaffold guide
  - Depends on: T4, T5
  - Files: docs/how-to/dagger-ci.md, docs/how-to/create-a-terreno-app.md, docs/explanation/dagger-ci.md, docs/reference/create-terreno-app.md
  - Criteria:
    - The how-to covers running checks locally, hosted CircleCI and GitHub Actions, and a self-hosted GitHub runner and CircleCI runner with a persistent engine, marks the self-hosted warm-cache benefit and the whole self-hosted section as untested, and states that hosted runs start cold, including the lost Bun cache. Verified by `docs-audit` and a reviewer reading the page against the generated files.
    - The docs state that Dagger Cloud and trace upload are off unless a token is set, name the telemetry opt-out, say why that matters for PHI, say how the CLI install is checksummed, and say how to pass a secret with `--secret`. Verified by a grep for each statement.
    - The reference documents the `--ci` flag and its values and states that the default is `inline`, that `github`, `circleci`, and `dagger` are opt-in, and that flipping the default waits on the speed comparison (X2). Verified by `docs-audit` and a grep for each statement.
    - The docs site builds and links resolve. Verified by the docs-site build.
  - Docs: this task
  - Skills: terreno:update-docs

## Open questions (recommendation assumed)

Q1, Q2, and Q7 were answered and are now D1, D2, and D3. X7 and X8 were added after.

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q3 | Pin the engine, or follow `latest`? | Pin to 0.21.11 | The spike ran on it, and `latest` would change CI under users | `latest` drops the pin from `dagger.json` and the host configs | T1, T4, T5 |
| Q4 | Should Flourish ever enable Dagger Cloud caching? | Not in this plan | Trace upload could carry test data across the HIPAA boundary; needs a BAA check first | Enabling it needs a PHI review, an opt-in flag, and a new task | T6 |
| Q5 | Does the generated CircleCI config need a `machine` variant? | No | Docker plus `setup_remote_docker` passed in pipeline 908 | A `machine` option adds a flag value and a template | T5 |
| Q6 | Keep the scaffold smoke job in Terreno CI long-term (T2)? | Yes, on `create-terreno-app/**` changes only | It is the only runnable check that the generated module still works; it costs CircleCI credits only when the generator changes | Dropping it leaves generator tests as string assertions only | T2 |
| Q8 | Pin the Bun and Mongo images by digest instead of tag? | Tag now, document the risk | Digests need a refresh process; Medicaid-data apps may want them | Digest pinning adds a pin-refresh task and test changes | T1, T6 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Measure a warm persistent engine on a self-hosted runner, and validate the generated config on one | Spike never got a self-hosted number | S | self-hosted runner access |
| X2 | Compare hosted Dagger time against existing CircleCI and GitHub jobs | Spike only ran cold; no baseline | S | T2, T4 |
| X7 | Flip the default `--ci` from `inline` to `github` | D1 deferred it until X2 reports | S | X2 |
| X3 | Move Terreno's own CircleCI jobs onto Dagger | You said "maybe not terreno itself" | L | X2 |
| X4 | Dagger functions for Expo export, Playwright, or Docker image builds | These stay in host config today | L | T2 |
| X5 | Publish the module as a shared Dagger module | Avoids per-app copies | M | T6 |
| X6 | System `mongod` for app suites that start their own in-memory replica set | The spike's `example-backend` suite needed one | M | T1 |
| X8 | Measure Dagger Cloud's shared cache against CircleCI's own caching | Asked whether Dagger Cloud is faster than CircleCI alone; unmeasured | S | X2, Q4 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Make the Dagger-calling GitHub config the default `--ci` before speed is measured? | Inline until measured | Default `--ci` is `inline` (today's workflows, with the empty-test fix); `github` and `circleci` are opt-in; flipping the default is X7 |
| D2 | Ship self-hosted as docs only in v1? | Yes ("ok") | v1 documents a GitHub self-hosted runner and a CircleCI runner with a persistent engine, labelled untested; no generated artifact |
| D3 | Mongo topology for `backendTest`? | Replica set | `backendTest` binds a single-node replica set with a primary wait and `directConnection=true`; T1 proves it with a change-stream test; plain Mongo is dropped |
| D4 | Where are Dagger runs verified? | On CircleCI ("just do it on circle for this test") | T1's `dagger call` proof is T2's amd64 smoke job; local Docker runs are optional |
| D5 | Sign off? | Approved with Q3 to Q6 and Q8 left on their recommendations | Q3 pin engine to 0.21.11; Q4 Dagger Cloud off; Q5 no `machine` variant; Q6 keep the smoke job; Q8 tag-pin images |

Q3 to Q6 and Q8 stay on their recommendations (D5).

## Sign-off

Status: approved 2026-10-25
Cut: 3 rounds, 33 findings: 30 fixed, 2 moved to questions or expansions, 1 rebutted (round 3, F9: T3 coupling to the smoke job is deliberate, they edit one CircleCI file)
