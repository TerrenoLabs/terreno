# E2E tests and manual regression cases in every plan

**Status:** Approved
**Roadmap:** Area=`tooling`, Target=`Next`, Impact=`Feature`
**Branch:** e2e-and-regression-testing
**Owner:** Josh Gachnang
**Created:** 2026-10-23

Terreno's lifecycle skills (Grow → Pick → Roast → Brew → Taste) prove each task with
tests, but the IP never says which end-to-end tests a feature needs, and nothing records
the manual checks a human should repeat before a release. Today bots decide on their own
whether a slice deserves a Playwright spec, and the knowledge of what to click through
after a release lives in nobody's file. Inside Terreno, only example-frontend, admin-spa
and create-terreno-app run anything end to end; the other 19 packages are tested only
in-process. This plan makes planned e2e tests and manual regression cases required IP
sections, defines one standard regression-suite format, and teaches the skills where to
find a repo's e2e guide. It then applies all of that to Terreno itself, with a small
real-process smoke test and an e2e guide for every package, so that apps and features
can keep growing without losing coverage.

## The idea

Three contracts, owned by the `terreno-planning` plugin and mirrored into brewery by a
sibling brewery IP:

1. **A standardized spot.** The standardized spot is `docs/testing/e2e.md` (how e2e tests are built and
   written) plus `docs/regression/` (manual suites). A repo whose layout differs
   overrides them with a `## Testing conventions` table in its agent instructions
   (AGENTS.md or CLAUDE.md) naming its e2e guide, regression-suite directory, and smoke
   command. When no guide exists at all, Grow adds a task to write one.
2. **Two required IP sections.** `## E2E tests` lists every planned spec or flow: its
   path, layer, the criterion it proves, and the task that writes it. `## Regression
   cases` lists the manual cases the feature adds or changes, in the suite format. Either
   section may be `None — <reason>`. It may never be missing.
3. **Regression suite format.** There is one living file per area,
   `docs/regression/<area>.md`, with stable case IDs (`AUTH-004`) and a fixed table.
   IDs in an IP are provisional (`AUTH-new-1`). Brew merges the IP's cases into the
   suite and assigns real IDs before it opens the PR, Taste renumbers on a collision
   with master, and the PR's Verification section links them.

Pick writes each planned spec in the task that delivers its behaviour. Roast runs the
specs and rejects regression steps that are not concrete. Brew blocks a PR when a
planned spec is missing or when the cases were not written to the suite. Taste
re-checks both when a review fix changes behaviour. An IP written before this contract
is treated as `None — predates contract`, with a warning, not a failure.

In Terreno, every package gets an `e2e/smoke.ts` (or `e2e/smoke.spec.ts` for browser
packages). Each one exercises the package's built output through its public entry in a
real process: a server on a real port, the compiled binary, or a page in Chromium. Each
takes about 30 s, not counting the build. A `smoke` script in every package, a root
`bun run smoke`, and a single CircleCI `smoke` job (compile and web builds first) run
them. `docs/testing/e2e.md` explains the test tiers and links to
`docs/testing/e2e/<package>.md`, one page per package on how that package is
e2e-tested.

Rejected: in-process `smoke.test.ts` files (the human chose real process, because
in-process tests duplicate the unit suite), and one regression file per feature (it
fragments and goes stale; the human chose one file per area).

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Contract reference, and Grow requires both sections (tracer) | none | terreno-planning plugin, validator | `bun test scripts/planning/` incl. new failing-fixture cases |
| T2 | Pick writes planned e2e specs in the delivering task | T1 | Pick skill | `bun run check:lifecycle-skills` + content grep, then PLAN-new-4 |
| T3 | Roast runs planned specs, checks regression steps | T1 | Roast skill | same, then PLAN-new-4 |
| T4 | Brew writes cases to the suite, gates on planned specs | T1 | Brew skill, attention contract | same, then PLAN-new-3 |
| T5 | Taste re-checks both after fixes and renumbers ID collisions | T1 | Taste skill | same, then PLAN-new-5 |
| T6 | Unattended Grow and scan Plot emit both sections | T1 | implement-ready-for-dev, scan Plot | `bun run rules` clean diff + grep |
| T7 | Validator enforces stage phrases; plugin docs, version, changelog | T2, T3, T4, T5 | validator, plugin docs | `bun test scripts/planning/` |
| T8 | Smoke harness, api smoke, root script (smoke tracer) | none | `@terreno/test`, api | `bun run --cwd api smoke` |
| T9 | CircleCI `smoke` job | T8 | CI | CircleCI `smoke` job green |
| T10 | E2E guide at `docs/testing/e2e.md` | T8 | docs | docs site build |
| T11 | Terreno declares its Testing conventions; IP template gains sections | T1, T8, T10 | rules, IP template | `bun run rules:check`, grep |
| T12–T31 | One real-process smoke and one e2e page per remaining package | T8 | each package | `bun run --cwd <pkg> smoke` |
| T32 | Regression suite README, seed area files, suite checker | T1, T8, T9 | `docs/regression/` | `bun run check:regression-suites` |
| T33 | Link every package page from the guide; full smoke run | T9, T10, T12–T32 | docs | docs site build, root `bun run smoke` |
| T34 | Walk the terreno planning regression cases; record the run | T7, T11, T32 | `docs/regression/planning.md` | recorded run with evidence |

Tracers: T1 (the IP contract that every later skill task reads) and T8 (the smoke
harness that every package task builds on) run in parallel.
E2E: one real-process smoke per package (E1–E21) plus validator fixture cases (E22).
Regression: five planning cases (PLAN-new-1 to PLAN-new-5), walked once in T34.
brewery: a sibling IP in the brewery repo
(`docs/plans/2026-10-23-e2e-and-regression-testing.md`) holds distill, cut and tap changes and the
resync. It is signed off with this one. Its resync runs only after this PR merges.
Out of scope: generated-app scaffolding, release-QA tooling, native smoke tests, bots
walking manual cases, and Flourish adoption. See Expansions.
Open risks: browser smokes add CI minutes (the web builds run once per job); the rtk
smoke uses shims for native modules (D6).

## E2E tests

This plan follows its own contract. Every smoke below is a new real-process spec.

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `api/e2e/smoke.ts` | http | A compiled `setupServer` app boots, serves `/health`, signs a user up, and does create + list on one model | T8 |
| E2–E19 | `<package>/e2e/smoke.ts` or `smoke.spec.ts` | per task | That package's happy path through its built public entry | T12–T29 |
| E20 | `demo/e2e/smoke.spec.ts` | browser | The demo export lists its stories and renders one story by route | T30 |
| E21 | `ui/e2e/smoke.spec.ts` | browser | Button, TextField and Modal respond to input in Chromium | T31 |
| E22 | `scripts/planning/lifecycleSkills.test.ts` new cases | unit | The validator rejects a stage skill or reference that is missing the new required phrases | T1, T7 |

## Regression cases

Destination: `docs/regression/planning.md`. T32 creates it and assigns the real IDs.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| PLAN-new-1 | Grow plans e2e and regression | In a fresh session in a repo that has `docs/testing/e2e.md`, run Grow on "add a due date to todos" and approve it | The IP has `## E2E tests` naming a spec path that follows the guide, and `## Regression cases` with at least one row in suite format | Claude Code, Cursor, Codex | Validator (phrases only) | e2e-and-regression-testing |
| PLAN-new-2 | Grow without a guide | Repeat PLAN-new-1 in a repo with no `docs/testing/e2e.md` and no Testing conventions table | The IP includes a task that writes the e2e guide at `docs/testing/e2e.md` | Claude Code | manual | e2e-and-regression-testing |
| PLAN-new-3 | Brew writes the suite | Take an approved IP with one regression case through Brew | The PR diff adds that row to `docs/regression/<area>.md` with the next free ID, and the PR Verification section links it | Claude Code | manual | e2e-and-regression-testing |
| PLAN-new-4 | Pick writes, Roast enforces a planned spec | Run Pick on a PLAN-new-1 task that owns an `## E2E tests` row. Then delete the spec file and run Roast | Pick creates the spec at the row's path. Roast returns `FAIL` and names the missing row | Claude Code | manual | e2e-and-regression-testing |
| PLAN-new-5 | Taste renumbers a collision | On a branch that added `AUTH-00N`, merge a master commit that also added `AUTH-00N`, then run Taste | Taste renumbers the branch's row to the next free ID, and `check:regression-suites` passes before push | Claude Code | manual | e2e-and-regression-testing |

## Tasks

### Phase 1 — Lifecycle contract (terreno-planning plugin)

- [x] **T1** — Define the testing-plan contract and require it in Grow
  - Depends on: none
  - Files: plugins/terreno-planning/references/testing-plan.md, plugins/terreno-planning/skills/terreno-1-grow/SKILL.md, plugins/terreno-planning/skills/terreno-1-grow/references/grilling.md, scripts/planning/lifecycleSkills.ts, scripts/planning/lifecycleSkills.test.ts, generated copies under plugins/terreno-claude/ and skills/
  - Delivers: `references/testing-plan.md` defines:
    - (a) **Standardized spot.** The e2e guide is `docs/testing/e2e.md` and the suites live in `docs/regression/`. An optional `## Testing conventions` table in AGENTS.md or CLAUDE.md overrides them, with keys `E2E guide`, `Regression suites` and `Smoke command`. The guide covers every e2e layer the repo uses (browser, native flow, http, process).
    - (b) **IP tables.** `## E2E tests` has columns `ID | Spec or flow | Layer | Proves | Written in`. `## Regression cases` has columns `ID | Case | Steps | Expected | Platforms | Automated by | Added`. Either table may be `None — <reason>`. Regression IDs in an IP are provisional (`<AREA>-new-N`).
    - (c) **Suite file format.** Each file has a title, `Owner`, `Last full run: <date> (<who>, <sha>)`, and the case table. IDs take the form `<AREA>-NNN` and are never reused. The next free ID is assigned only when a case is written to the suite.
    - (d) **Deferral rule.** A stage that cannot run a row's layer records the row as `deferred` with the exact command. Only Brew may accept a deferred row, and only once it has passed locally or in product CI on the branch.
    - (e) **Regression-step bar.** Each step names a concrete starting state, an action, and an observable Expected.
    - (f) **Legacy rule.** An IP approved before the contract, which lacks a section, is read as `None — predates contract`. Stages warn and do not fail.

    In Grow:
    - Step 1 reads the spot or the override.
    - Step 7 pairs each UI or cross-process criterion with a planned spec, or gives a reason.
    - Step 8 writes both sections, and adds a guide-writing task when no guide exists.
    - The approval brief gains `E2E:` and `Regression:` lines under the plan table. The headings stay unchanged.
  - Acceptance:
    - `bun test scripts/planning/` passes.
    - New cases in `lifecycleSkills.test.ts` fail validation for a Grow SKILL.md without the two-section requirement, and for a missing `testing-plan.md`.
    - `testing-plan.md` passes `PORTABILITY_MARKERS`.
    - `bun run skills:check` is clean.
  - Docs: the reference itself is the doc. Plugin docs land in T7.
  - Skills: update-agent-docs

- [x] **T2** — Pick writes each planned e2e spec in the task that delivers it
  - Depends on: T1
  - Files: plugins/terreno-planning/skills/terreno-2-pick/SKILL.md, plugins/terreno-planning/skills/terreno-2-pick/references/testing.md, generated copies
  - Delivers:
    - Step 5 (Specify) reads the current task's `## E2E tests` rows and the e2e guide.
    - Step 6 writes each spec at the named path, following the guide.
    - When a row's path or layer no longer fits, Pick updates the row in the IP with a one-line reason, and never skips it silently.
    - `testing.md` gains a "Planned e2e specs" section that points to `testing-plan.md`.
  - Acceptance:
    - `bun run skills:check` and `bun run check:lifecycle-skills` pass.
    - The generated `skills/terreno-2-pick/SKILL.md` contains "## E2E tests" and "e2e guide".
    - PLAN-new-4 holds in T34.
  - Skills: update-agent-docs

- [x] **T3** — Roast runs planned specs and rejects vague regression steps
  - Depends on: T1
  - Files: plugins/terreno-planning/skills/terreno-3-roast/SKILL.md, generated copies
  - Delivers:
    - The step 3 matrix includes every `## E2E tests` row for the task.
    - A missing or failing row is `FAIL`.
    - A row Roast cannot run is `deferred`, per testing-plan rule (d).
    - A regression row that misses the testing-plan (e) bar is `FAIL`.
  - Acceptance:
    - The same checks as T2 pass.
    - The generated Roast SKILL.md contains "## E2E tests", "## Regression cases" and "deferred".
    - PLAN-new-4 holds in T34.
  - Skills: update-agent-docs

- [x] **T4** — Brew merges regression cases into the suite and gates on planned specs
  - Depends on: T1
  - Files: plugins/terreno-planning/skills/terreno-4-brew/SKILL.md, plugins/terreno-planning/references/github-attention-contract.md, generated copies
  - Delivers: In its final gates, Brew:
    - (a) Confirms that every `## E2E tests` row exists at its path and passed; a deferred row needs a passing local or CI run on the branch. Otherwise it returns `FAIL` with `next: pick`.
    - (b) Merges every `## Regression cases` row into `<suite dir>/<area>.md`. It creates the file from the format when it is missing, assigns the next free ID, and sets `Added` to the IP slug.
    - (c) Lists the new or changed case IDs in the PR Verification section, under ⚠️ Not tested when nobody ran them. The attention contract adds that row type.
  - Acceptance:
    - The same checks as T2 pass.
    - The generated Brew SKILL.md contains "Regression suites" and "next free ID".
    - PLAN-new-3 holds in T34.
  - Skills: update-agent-docs

- [ ] **T5** — Taste re-checks both sections after fixes and renumbers ID collisions
  - Depends on: T1
  - Files: plugins/terreno-planning/skills/terreno-5-taste/SKILL.md, generated copies
  - Delivers:
    - When a review or CI fix changes behaviour, Taste re-runs the affected `## E2E tests` rows and updates the suite rows before it pushes.
    - When a merge with master, or the repo's suite check, finds a regression ID collision, it renumbers the branch's new rows to the next free IDs.
    - When the repo declares a smoke command, the pre-push subagent runs it.
  - Acceptance:
    - The same checks as T2 pass.
    - The generated Taste SKILL.md contains "renumber" and "## E2E tests".
    - PLAN-new-5 holds in T34.
  - Skills: update-agent-docs

- [x] **T6** — Unattended Grow and scan Plot emit both sections
  - Depends on: T1
  - Files: .rulesync/skills/implement-ready-for-dev/SKILL.md, plugins/terreno-scan/skills/terreno-scan-4-plot/SKILL.md, plugins/terreno-scan/.cursor-plugin/plugin.json, plugins/terreno-scan/.codex-plugin/plugin.json, generated outputs of `bun run rules` and `bun run skills:sync`
  - Delivers:
    - implement-ready-for-dev's pinned Pick-plan fields gain `E2E tests` and `Regression cases`.
    - Plot's Grow brief lists each slice's planned specs, or `None — <reason>`.
    - The scan plugin version goes from 2.11.0 to 2.12.0.
  - Acceptance:
    - `bun run rules` leaves a clean `git diff`.
    - `bun run skills:check` and `bun run check:lifecycle-skills` pass.
    - Both generated skills contain "## E2E tests".
  - Skills: update-agent-docs, improve-rulesync

- [ ] **T7** — Enforce the new stage phrases and document the contract
  - Depends on: T2, T3, T4, T5
  - Files: scripts/planning/lifecycleSkills.ts, scripts/planning/lifecycleSkills.test.ts, plugins/terreno-planning/skills/update-docs/SKILL.md, plugins/README.md, docs/reference/lifecycle-plugin.md, docs/explanation/planning-plugins.md, plugins/terreno-planning/.cursor-plugin/plugin.json, plugins/terreno-planning/.codex-plugin/plugin.json, .claude-plugin/marketplace.json, .cursor-plugin/marketplace.json, regenerated plugins/terreno-claude/ and skills/ (never hand-edited), changelog/unreleased/lifecycle-e2e-and-regression.md
  - Delivers:
    - `validateStageContent` requires the phrases added in T2–T5.
    - update-docs names the testing-plan spots as the one exception to its Diátaxis layout.
    - The plugin version moves to 2.13.0 in the canonical manifests and the marketplaces, and the generated copies are regenerated.
    - The lifecycle reference documents the spot, both IP sections, and the suite format, each with one minimal example.
  - Acceptance:
    - `bun test scripts/planning/` passes, including new cases that fail when a Pick, Roast, Brew or Taste skill is missing its phrase.
    - `bun run skills:check` and `bun run check:changelog` pass.
  - Docs: docs/reference/lifecycle-plugin.md, docs/explanation/planning-plugins.md, plugins/README.md
  - Skills: update-docs

### Phase 2 — Terreno adopts the convention

- [x] **T8** — Smoke harness, api smoke, and root script (smoke tracer)
  - Depends on: none
  - Files: test/src/smoke/*.ts, test/package.json (export), api/e2e/smoke.ts, api/package.json, package.json (root `smoke` script), workspace package.json files that lack `@terreno/test` (adding it as a devDependency), bun.lock, knip.jsonc (an `e2e/smoke.{ts,spec.ts}` entry for every workspace)
  - Delivers:
    - `@terreno/test` exports these smoke helpers:
      - `freePort()`
      - `smokeMongoUri()`: `TERRENO_TEST_MONGODB_URI` when set (CI sidecar), otherwise an in-memory replica set
      - `spawnUntilReady({cmd, url, timeoutMs})`, which kills the child on exit
      - `spawnExampleBackend()`, which starts example-backend by path. Client packages (rtk, syncdb, admin-frontend) use it, so they never import `@terreno/api`; syncdb is a dependency of api.
      - `runBin({bin, args})`
    - Every workspace that will get a smoke gains a `@terreno/test` devDependency now, so later tasks touch neither `bun.lock` nor `knip.jsonc`.
    - The api smoke runs a minimal compiled `setupServer` app with one `modelRouter` model as a child process. Over real HTTP it checks `/health`, signs up, then does create and list.
    - The root `smoke` script runs every workspace's `smoke` script one at a time and prints each package's time.
  - Acceptance:
    - After `bun run compile`, `bun run --cwd api smoke` exits 0 in at most 30 s.
    - The smoke exits non-zero when the `/health` route is removed. This is shown once in the task notes.
    - `bun run check:knip` passes.
  - Docs: docs/reference/test.md (the smoke helpers)
  - Skills: backend-test-env, terreno-backend-api, update-docs

- [x] **T9** — CircleCI `smoke` job
  - Depends on: T8
  - Files: .circleci/config.yml, .circleci/continue-config.yml, scripts/ci/prepush/plan.ts, docs/how-to/run-tests-locally.md
  - Delivers:
    - A `smoke` job on the `node22_browsers_mongo_rs` executor, run on any package change, with `TERRENO_TEST_MONGODB_URI` set to the sidecar.
    - Its steps: install, `bun run compile`, `bun run --cwd admin-spa build:web`, `bun run --cwd demo export`, Playwright Chromium install, then `bun run smoke`. Later browser smokes therefore need no config edit.
    - The `bun run smoke` step is removed from `admin-spa-ci`.
    - prepush prints the smoke command as a hint, and run-tests-locally maps the job to it.
  - Acceptance: The CircleCI `smoke` job is green on the PR. `admin-spa-ci` no longer runs the smoke.

- [x] **T10** — E2E guide at the standardized spot
  - Depends on: T8
  - Files: docs/testing/e2e.md, docs/testing/e2e/api.md, website/sidebars.ts
  - Delivers: `docs/testing/e2e.md` explains:
    - the test tiers: unit → smoke → e2e → manual regression
    - the file and script conventions
    - the rule "real process, built output, one happy path, about 30 s excluding build"
    - how to write a Playwright spec (testID selectors, `loginAs`, no `waitForTimeout`)
    - how to write a Maestro flow (`.maestro/flows/`, testIDs, run command)
    - where regression suites live
    - a table of packages, filled in by T33

    The sidebar gains a Testing category, and `api.md` is the first package page.
  - Acceptance: The docs site build (`bun run --cwd website build`) passes.
  - Skills: update-docs

- [ ] **T11** — Declare Terreno's Testing conventions and extend the IP template
  - Depends on: T1, T8, T10
  - Files: .rulesync/rules/00-root.md, generated rule outputs (AGENTS.md, CLAUDE.md and the other `bun run rules` targets), docs/implementationPlans/IP_TEMPLATE.md, docs/implementationPlans/README.md
  - Delivers:
    - The root rule gains a `## Testing conventions` table: E2E guide = `docs/testing/e2e.md`, Regression suites = `docs/regression/`, Smoke command = `bun run smoke`. Terreno uses the defaults; the table makes them explicit.
    - IP_TEMPLATE gains `## E2E tests` and `## Regression cases`, placed before `## Acceptance Criteria`.
  - Acceptance:
    - `bun run rules:check` passes.
    - `grep -n "## Testing conventions" AGENTS.md CLAUDE.md` finds both files.
    - The template contains both headings.
  - Skills: improve-rulesync, update-docs

Each package task below writes only three files:

- `<pkg>/e2e/smoke.ts` (or `smoke.spec.ts`)
- a `smoke` script in `<pkg>/package.json`
- `docs/testing/e2e/<pkg>.md`, which covers the package's test tiers, its smoke, how to add an e2e spec, and its measured time

Every smoke runs in at most 30 s, excluding the build. Server smokes get Mongo from
`smokeMongoUri()`.

- [x] **T12** — Smoke test for `@terreno/test`
  - Depends on: T8
  - Files: test/e2e/smoke.ts, test/package.json, docs/testing/e2e/test.md
  - Acceptance: `bun run --cwd test smoke` exits 0. It gets a replica-set URI, opens a change stream, spawns a trivial HTTP child, and waits until the child is ready.

- [x] **T13** — Smoke test for `@terreno/api-health`
  - Depends on: T8
  - Files: api-health/e2e/smoke.ts, api-health/package.json, docs/testing/e2e/api-health.md
  - Acceptance: `bun run --cwd api-health smoke` exits 0. A real server with the plugin answers its health route with a healthy status.

- [ ] **T14** — Smoke test for `@terreno/feature-flags`
  - Depends on: T8
  - Files: feature-flags/e2e/smoke.ts, feature-flags/package.json, docs/testing/e2e/feature-flags.md
  - Acceptance: `bun run --cwd feature-flags smoke` exits 0. A flag created over HTTP evaluates as on for a user.

- [ ] **T15** — Smoke test for `@terreno/announcements`
  - Depends on: T8
  - Files: announcements/e2e/smoke.ts, announcements/package.json, docs/testing/e2e/announcements.md
  - Acceptance: `bun run --cwd announcements smoke` exits 0. An announcement created over HTTP shows up in a signed-in user's list.

- [ ] **T16** — Smoke test for `@terreno/comms`
  - Depends on: T8
  - Files: comms/e2e/smoke.ts, comms/package.json, docs/testing/e2e/comms.md
  - Acceptance: `bun run --cwd comms smoke` exits 0. A message sent through a real server with an in-memory or console adapter is recorded as delivered, with no external calls.

- [ ] **T17** — Smoke test for `@terreno/jobs`
  - Depends on: T8
  - Files: jobs/e2e/smoke.ts, jobs/package.json, docs/testing/e2e/jobs.md
  - Acceptance: `bun run --cwd jobs smoke` exits 0. A job that one process enqueues is completed by a separate worker process.

- [ ] **T18** — Smoke test for `@terreno/ai`
  - Depends on: T8
  - Files: ai/e2e/smoke.ts, ai/package.json, docs/testing/e2e/ai.md
  - Acceptance: `bun run --cwd ai smoke` exits 0 with no provider keys set. A chat request to a real server that uses a deterministic fake provider returns the fake provider's text.

- [ ] **T19** — Smoke test for `@terreno/admin-backend`
  - Depends on: T8
  - Files: admin-backend/e2e/smoke.ts, admin-backend/package.json, docs/testing/e2e/admin-backend.md
  - Acceptance: `bun run --cwd admin-backend smoke` exits 0. Over HTTP, an admin lists the admin config and one model's documents, and a non-admin gets 403.

- [ ] **T20** — Align the `@terreno/admin-spa` smoke with the convention
  - Depends on: T8
  - Files: admin-spa/e2e/smoke.ts, admin-spa/package.json, docs/testing/e2e/admin-spa.md
  - Acceptance: After `build:web`, `bun run --cwd admin-spa smoke` exits 0 and still serves the SPA through the Express plugin. The package page lists the existing `test:e2e` and `test:integration` suites.

- [ ] **T21** — Smoke test for `@terreno/admin-frontend`
  - Depends on: T8
  - Files: admin-frontend/e2e/smoke.spec.ts, admin-frontend/package.json, docs/testing/e2e/admin-frontend.md
  - Acceptance: `bun run --cwd admin-frontend smoke` exits 0. In Chromium, an admin signs in to the admin-spa build against `spawnExampleBackend()`, and AdminHome lists at least one model, found by `testID`.

- [ ] **T22** — Smoke test for `@terreno/rtk`
  - Depends on: T8
  - Files: rtk/e2e/smoke.ts, rtk/package.json, docs/testing/e2e/rtk.md
  - Acceptance: `bun run --cwd rtk smoke` exits 0. A store built from the compiled rtk package signs in through Better Auth against `spawnExampleBackend()`, and an authenticated query returns the signed-in user. The runtime follows D6: Bun, with rtk's existing native-module shims. The package page names the shims.

- [ ] **T23** — Smoke test for `@terreno/syncdb`
  - Depends on: T8
  - Files: syncdb/e2e/smoke.ts, syncdb/package.json, docs/testing/e2e/syncdb.md
  - Acceptance: `bun run --cwd syncdb smoke` exits 0. Two clients built from the compiled syncdb connect to `spawnExampleBackend()`. A todo written by client A appears in client B's store within 5 s.

- [ ] **T24** — Smoke test for `@terreno/blocks`
  - Depends on: T8
  - Files: blocks/e2e/smoke.ts, blocks/package.json, docs/testing/e2e/blocks.md
  - Acceptance: `bun run --cwd blocks smoke` exits 0. The compiled `terreno-blocks` binary accepts a valid document with exit code 0, and rejects an invalid one with a non-zero exit code and an error message.

- [ ] **T25** — Smoke test for `@terreno/cli`
  - Depends on: T8
  - Files: cli/e2e/smoke.ts, cli/package.json, docs/testing/e2e/cli.md
  - Acceptance: `bun run --cwd cli smoke` exits 0. The compiled `terreno` binary prints its version and runs one offline subcommand that exits 0.

- [ ] **T26** — Smoke test for `@terreno/mcp`
  - Depends on: T8
  - Files: mcp-server/e2e/smoke.ts, mcp-server/package.json, docs/testing/e2e/mcp-server.md
  - Acceptance: `bun run --cwd mcp-server smoke` exits 0. The compiled `terreno-mcp` binary completes MCP `initialize` and `tools/list` over stdio, and the list has at least one tool.

- [ ] **T27** — Smoke test for `create-terreno-app`
  - Depends on: T8
  - Files: create-terreno-app/e2e/smoke.ts, create-terreno-app/package.json, docs/testing/e2e/create-terreno-app.md
  - Acceptance: `bun run --cwd create-terreno-app smoke` exits 0. The compiled binary generates an app into a temp dir without prompts. The generated backend entry then builds with `bun build` against the workspace packages, with no network install.

- [ ] **T28** — Smoke test for example-backend
  - Depends on: T8
  - Files: example-backend/e2e/smoke.ts, example-backend/package.json, docs/testing/e2e/example-backend.md
  - Acceptance: `bun run --cwd example-backend smoke` exits 0. `src/index.ts` boots as a child process, `/health` reports `healthy: true`, and a seeded user signs in.

- [ ] **T29** — Smoke spec for example-frontend
  - Depends on: T8
  - Files: example-frontend/e2e/smoke.spec.ts, example-frontend/package.json, scripts/ci/e2eAffected/shards.ts, docs/testing/e2e/example-frontend.md
  - Acceptance: `bun run --cwd example-frontend smoke` exits 0. A user signs in with `loginAs`, reaches the todos screen, and creates a todo, finding every element by `testID`. `bun test scripts/ci/e2eAffected/` passes.
  - Skills: verify-ui-changes

- [ ] **T30** — Smoke spec for demo
  - Depends on: T8
  - Files: demo/e2e/smoke.spec.ts, demo/package.json, docs/testing/e2e/demo.md
  - Acceptance: After `export`, `bun run --cwd demo smoke` exits 0. In Chromium, the demo home lists the stories, and opening one story by route renders its root `testID`.
  - Skills: verify-ui-changes

- [ ] **T31** — Smoke spec for `@terreno/ui`
  - Depends on: T8
  - Files: ui/e2e/smoke.spec.ts, ui/package.json, docs/testing/e2e/ui.md
  - Acceptance: `bun run --cwd ui smoke` exits 0, run against the demo export built by `bun run --cwd demo export`. In Chromium, a Button press changes visible state, a TextField takes typed input, and a Modal opens and dismisses.
  - Skills: terreno-ui, verify-ui-changes

### Phase 3 — Regression suites, docs join, proof

- [ ] **T32** — Regression suite README, seed area files, and suite checker
  - Depends on: T1, T8, T9
  - Files: docs/regression/README.md, docs/regression/planning.md, docs/regression/auth.md, docs/regression/admin.md, docs/regression/syncdb.md, docs/regression/ui-native.md, scripts/regression/checkSuites.ts, scripts/regression/checkSuites.test.ts, package.json (`check:regression-suites`), .circleci/continue-config.yml (the check added to the existing lint job), scripts/ci/prepush/plan.ts
  - Delivers:
    - The README restates the suite format and indexes the areas.
    - `planning.md` holds this IP's five cases as PLAN-001 to PLAN-005.
    - Each other area file holds 2–4 genuinely manual cases that Playwright and Maestro do not cover: native-only behaviour, real email delivery, and platform permission prompts.
    - `checkSuites.ts` validates the header and table columns, checks that IDs are unique and well formed (no `-new-`), and rejects empty Steps or Expected.
  - Acceptance:
    - `bun run check:regression-suites` passes.
    - `checkSuites.test.ts` fails three fixtures: a duplicate ID, an empty Expected, and a `-new-` ID.
  - Docs: docs/regression/README.md
  - Skills: update-docs

- [ ] **T33** — Link every package page from the guide and run the full smoke
  - Depends on: T9, T10, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29, T30, T31, T32
  - Files: docs/testing/e2e.md, docs/README.md, changelog/unreleased/package-smoke-tests.md
  - Delivers: The guide's table links all 21 package pages, with each smoke's measured time, and links `docs/regression/`. `docs/README.md` indexes the Testing and Regression pages.
  - Acceptance:
    - The docs site build passes with no broken links.
    - The root `bun run smoke` exits 0 locally, and every package finishes in 30 s or less.
    - The CircleCI `smoke` job is green.
  - Skills: update-docs

- [ ] **T34** — Walk the planning regression cases and record the run
  - Depends on: T7, T11, T32
  - Files: docs/regression/planning.md
  - Delivers: Using this branch's plugin build in a scratch repo, the run walks PLAN-001 to PLAN-005 once. It stamps `Last full run`, and adds the evidence (excerpts of the generated IP, PR diff, and Roast and Taste results) to the PR Verification section.
  - Acceptance: All five cases meet their Expected. A failing case is `FAIL`, routed back to its owning task (T1–T5).

## Assumptions

- The task list lives in this IP, not in `docs/tasks/`. brewery parses task lines from the IP. `docs/tasks/<slug>.md` is optional in this repo; roadmap tooling links it only when the file is present.
- Only T8 touches `bun.lock` and `knip.jsonc`, because it adds `@terreno/test` to every workspace up front. Browser smokes use the root `@playwright/test` (resolved to 1.63.0) and the web builds the `smoke` job makes. Only T9 and T32 (ordered after T9) touch CI config.
- Plugin references stay portable, with no `bun run` and no `@terreno/` (`PORTABILITY_MARKERS`). `docs/testing/e2e.md` and `docs/regression/` are generic conventions, not Terreno paths.
- These skills need no edits:
  - The outer loops (`terreno-pick-roast-loop`, `terreno-planning-loop`, `terreno-taste-sweep`), because they invoke the stages that change.
  - building-terreno-apps and terreno-ui, because they describe components, not planning.
  - verify-ui-changes, because bots do not walk manual cases (D5).
- brewery changes live in a sibling IP, `~/src/brewery/docs/plans/2026-10-23-e2e-and-regression-testing.md`, signed off together with this one. Its tasks run in the brewery repo, so barrel never picks them in this worktree. Its resync runs only after this PR merges, so it vendors a SHA from master.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q3 | Who writes regression cases into the suite? | Brew, at the final gate | Cases are final only after Roast, and Brew already owns the docs gate | Every IP gets a final task that Grow adds, and Brew only checks it | T4 |
| Q5 | Do `website` and `@terreno/test` get smoke tests? | `test` yes (it checks the harness itself). `website` no, because the docs-site build in CI already proves it | Meets "for each package" with the least redundant work | Add a website task that serves the built site and fetches two pages (+1 task, about 3 min of CI) | T12, T33 |
| Q6 | How does CI run the smokes? | One CircleCI `smoke` job that builds once, then runs the smokes one at a time | New smokes join with no config edit, and the per-package times stay meaningful | One path-filtered job per package: faster PRs, but about 20 config edits | T9 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | create-terreno-app scaffolds `docs/testing/e2e.md`, `docs/regression/`, and a `smoke` script | Consumer apps should start compliant | M | T8, T11 |
| X2 | A release-QA command that prints the suites as a checklist and stamps `Last full run` | Manual cases need a ritual to stay alive | S | T32 |
| X3 | Adopt the convention in Flourish (guide, seed suites) | Flourish is the main consumer | M | T1 |
| X4 | Native smokes (Maestro on the emulator companion) for ui, demo, and example-frontend | Browser smokes don't prove iOS or Android | L | T30, T31 |
| X5 | Fix the stale `app` shard row in run-tests-locally.md (missing todo-windows and notifications) | Found during research | S | none |
| X6 | Run only the affected smokes, reusing the e2e-affected gate | Keeps the `smoke` job fast as packages grow | M | T33 |
| X7 | Have verify-ui-changes walk a PR's new regression cases | Possible bot assist for manual cases (D5) | S | T4 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 (durable) | What should the "very simple regression smoke test" be for each package? | Real process: built output, public entry, a real port, the binary, or a browser; one happy path, about 30 s; one CI job | T8–T31 are real-process smokes with a 30 s budget, not in-process `bun test` files |
| D2 (durable) | Where should a finished feature's manual regression cases be written? | One file per area, `docs/regression/<area>.md`, in a standard table; each feature adds or edits rows | The suite format is defined in T1, Brew merges rows in T4, and the seed files land in T32 |
| D3 | Should this plan cover brewery too? | Both in this plan | The sibling brewery IP is signed off together with this one, as a separate PR |
| D4 (durable) | Where is the standardized e2e spot? (Q1) | "do both of those. it should be obvious but we should also support the agent lookup if needed" — read as: the obvious default `docs/testing/e2e.md` + `docs/testing/e2e/<package>.md` + `docs/regression/`, AND the Testing conventions table in AGENTS.md/CLAUDE.md that agents consult when present | Plan unchanged: T1 (a) defines both, T10 builds the default spot, T11 declares Terreno's table; update-docs names the exception (T7) |
| D5 | Do bots execute manual regression cases? (Q4) | No, humans only | verify-ui-changes untouched; X7 parked |
| D6 | How does the rtk smoke run? (Q7) | Bun with rtk's existing native shims, against a real backend | T22 as written |
| D7 | Approve both plans? | ok, approve | Status approved on this IP and the sibling brewery IP |

## Sign-off

Status: approved 2026-10-23
Cut: 2 rounds, 23 findings: 21 fixed, 2 moved to questions (Q1 now fundamental, Q4 bot-walking to X7), 0 rebutted
