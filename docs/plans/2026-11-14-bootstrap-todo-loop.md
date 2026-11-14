# Bootstrap todo loop: staged, self-scoring regression harness for the bootstrap template

Terreno ships a bootstrap path (the `terreno_bootstrap` MCP prompt, which runs
`create-terreno-app`, then `terreno_bootstrap_ai_rules`) and a dogfooding skill
(`build-terreno-app`), but nothing builds the same app the same way on every release and
says what got worse. A weekly CI job (`bootstrap-app-check.yml`) only proves the scaffold
compiles. This plan adds a repeatable loop: a deliberately naive prompt ("make me a todo
app") drives the bootstrap through eleven named stages, a separate agent session scores the
result against a fixed rubric and against the previous version's timings, failing stages are
rerun until the rubric passes or iterations run out, and the whole thing runs once per minor
version of the template. Terreno maintainers feel the difference: a regression in the
template, the bootstrap prompt or the docs shows up as a red rubric row or a slower stage,
with the version that introduced it.

## The idea

A **stage contract**: every stage is an entry in one registry (`id`, order, `kind`
deterministic or agent, prompt file, verify checks) and every run of a stage writes
`<runDir>/stages/<id>.json` = `{stage, version, status, attempt, startedAt, endedAt,
minutes, checks[], log}`. The runner (`bun run bootstrap-loop stage|build|score|loop|matrix|upload`)
reads and writes only that JSON plus the app directory, so a single stage, a full build, the
scorer, the iteration loop and the version matrix are thin layers over one file format.
The scorer is a different process from the builder: a fresh `claude -p` session with
read-only tools that sees only the rubric and an evidence bundle the deterministic probes
collected, never the builder's transcript.

Rejected alternative: one long builder session that builds and grades itself. It cannot run
a stage in isolation, and a self-grading builder hides its own failures.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: stage contract, runner CLI, builder executor, `scaffold` stage driven by the version's bootstrap prompt | none | `scripts/bootstrapLoop/` | `bun test scripts/bootstrapLoop/` + E1 (process) |
| T2 | The ten later stages with prompts and per-stage checks | T1 | `scripts/bootstrapLoop/`, skill `references/stages/` | `bun test` with a fake builder command |
| T3 | `bootstrap-todo-loop` skill (naive prompt → stages) | T2 | `.rulesync/skills/bootstrap-todo-loop/` + generated copies | `bun run rules:check`, skill lint |
| T4 | `build` command: all stages in order, timing, resume | T2 | `scripts/bootstrapLoop/build.ts` | `bun test` + E2 (process) |
| T5 | Evidence probes for every rubric row | T1 | `scripts/bootstrapLoop/score/probes/` | `bun test` with fixture apps |
| T6 | Scorer session, `SCORE.md`, time-regression comparison | T5 | `scripts/bootstrapLoop/score/` | `bun test` with a fake scorer command |
| T7 | Iteration loop with per-iteration log | T4, T6 | `scripts/bootstrapLoop/loop.ts` | `bun test` (fake builder + scorer) |
| T8 | Version matrix, output diff, regression report | T7 | `scripts/bootstrapLoop/matrix/` | `bun test` with a fake registry |
| T9 | Artifact upload with redaction, teardown | T7 | `scripts/bootstrapLoop/upload.ts`, `teardown.ts` | `bun test` |
| T12 | Docs and CI wiring of the harness tests | T8, T9 | `docs/`, `.circleci/`, `bootstrap-app-check.yml` | `bun run test:bootstrap-loop`, `bun run check:circleci-parity` |
| T10 | Real runs: one single-stage run, one full loop on the latest version to a green rubric | T9, T12, Q1 | `docs/bootstrapLoop/runs/<version>/` | committed `score.json` all rows PASS |
| T11 | Real matrix across every version (Q2), regressions found, noted and fixed at HEAD where possible | T10, T8, Q1, Q2 | `docs/bootstrapLoop/REGRESSIONS.md`, fixes | committed report + fix PR commits |

Tracer: the `scaffold` stage run alone, the builder following that version's bootstrap prompt, (`bun run bootstrap-loop stage scaffold --version local`) writes a valid stage JSON and a scaffolded app.
E2E: 2 specs (process): the single-stage CLI run and the full `build` with a fake builder.
Regression: None — no hard-to-automate change; the loop itself is the automated check.
User guide: None — no change to what example-app users see or do.
Design: None — no canvas; the built app's look is judged by the scorer's visual rubric row.
Out of scope: X1 scheduled CI run of the matrix, X2 native-device scoring, X3 varying the driver skill per version, X4 other app concepts (see Expansions).
Open risks: external accounts and keys (Q1) gate R2's deploy check, R5, R9 and R13; ~20 full agent builds cost real time and money (Q3); published template versions are immutable, so old-version regressions can only be noted, not fixed (Q4).
Elephant: the full matrix is roughly 20 agent builds × up to 3 iterations, likely 20–60 wall-clock hours and several hundred dollars of model spend, and every build creates a deploy and two CI runs on external services.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `scripts/bootstrapLoop/e2e/stage.e2e.test.ts` | process | `bun run bootstrap-loop stage scaffold --version local --run-dir <tmp>` with a fake builder that follows the local bootstrap prompt (`terreno bootstrap app --terreno-path`) exits 0, writes `stages/scaffold.json` with `status: PASS`, and the app's backend type-checks with exact-pinned Terreno deps (weekly/tag job, not PRs) | T1 |
| E2 | `scripts/bootstrapLoop/e2e/build.e2e.test.ts` | process | `bun run bootstrap-loop build` with `BOOTSTRAP_LOOP_BUILDER_CMD` pointing at a fake builder runs all eleven stages in registry order and writes eleven stage JSONs plus `build.json` with per-stage and total minutes | T4 |

## Regression cases

None — no hard-to-automate change. Visual quality and mobile layout are judged by the scorer
from Playwright screenshots, not by a person walking a suite.

## User guide

None — no change to what example-app users see or do; the harness is maintainer tooling
documented in `docs/reference/bootstrap-loop.md` and `docs/how-to/run-bootstrap-loop.md` (T9).

## Design

None — no canvas.

## Architecture decisions

- **Versions under test (pending Q2).** Recommended matrix: the latest published patch of
  every minor line from 57.4 (first `create-terreno-app` release; tag 57.4.0) through the
  newest 58.x, about 20 versions, plus `local` (this checkout), plus one build each of 0.31
  (last of major 0) and 57.3 (last pre-template 57), reported as a separate stack outside the
  regression diff. Those two scaffold through the MCP tool `terreno_bootstrap_app` instead of
  `create-terreno-app` (`git show 0.31.0:mcp-server/src/bootstrap.ts`), so the scaffold stage
  points the builder's `.mcp.json` at that version's `@terreno/mcp`.
- **The scaffold stage drives the bootstrap prompt.** `scaffold` is an agent stage: the
  builder receives the naive prompt plus that version's `terreno_bootstrap` prompt text and
  carries out the prompt's own steps (`create-terreno-app`, `terreno_bootstrap_ai_rules`,
  rulesync generate). The prompt text is rendered by installing `@terreno/mcp@<v>` into a temp
  dir and importing `dist/prompts.js` by file path (bypassing the exports map, since
  `@terreno/mcp/bootstrap` only exists from 57.5.0), then calling
  `handlePromptRequest("terreno_bootstrap", {appName, appDisplayName})`; for `local` it comes
  from this checkout's `mcp-server`, and the runner rewrites its `bunx create-terreno-app …`
  line to `bun <checkout>/cli/dist/bin.js bootstrap app … --terreno-path <checkout>` so the
  builder scaffolds HEAD, not the published template. The builder's `.mcp.json` points at `@terreno/mcp@<v>` so
  the prompt's tool calls hit that version. After the builder, the stage pins every
  `@terreno/*` and `create-terreno-app`-written Terreno dependency to exactly `<v>` (the
  template writes caret ranges, `create-terreno-app/src/generate.ts:12`, which would otherwise
  resolve every 57.x build to the newest 57.x), installs, and type-checks. The naive driver
  skill and later stage prompts are fixed at HEAD so runs stay comparable (X3).
- **Time accounting.** A stage's minutes are the sum of every attempt's wall-clock time in
  the run (first build plus every iteration rerun); `build.json` and the iteration log record
  both `firstPassMinutes` and `totalMinutes` per stage. Time regressions compare `totalMinutes`;
  scorer time is listed separately as `scoreMinutes` and in the total build time.
- **Secrets and teardown.** Every log, stage JSON and uploaded file passes through a
  redactor that replaces with `[redacted]` the values of every env var named `*TOKEN*`, `*KEY*`, `*SECRET*`,
  `*PASSWORD*`, `*_URI`, `*_URL` containing credentials (`://user:pass@`), every value in the app's
  `**/.env*` files, and the rotated admin password. The app tarball excludes `.env*`, `.vercel/`,
  `node_modules` and `.git`. Each matrix version's deploy, database and CI branch
  is torn down after scoring except the latest version's, which stays up as the demo
  (`bun run bootstrap-loop teardown`).
- **Stages** (registry order; `kind`; rubric rows each one owns):

  | # | id | kind | Owns rubric rows |
  | --- | --- | --- | --- |
  | 1 | `scaffold` | agent (bootstrap prompt) + deterministic pin/install/type-check | — (gate: app installs and type-checks at exactly `<v>`) |
  | 2 | `auth` | agent | R2 secure auth |
  | 3 | `admin` | agent | R1 admin user, R12 initial user seeded |
  | 4 | `theming` | agent | R3 theme and visual quality, R4 desktop and mobile |
  | 5 | `features` | agent | R7 new features present |
  | 6 | `roles` | agent | R8 roles work |
  | 7 | `consent` | agent | R6 consent forms present |
  | 8 | `ai` | agent | R5 GPT setup works, R10 AI tooling wired up |
  | 9 | `ci` | agent | R9 GitHub Actions and CircleCI passing with coverage |
  | 10 | `deploy` | agent | R13 app deployed |
  | 11 | `checklist` | agent | R11 CHECKLIST.md present |

- **Rubric** (all must PASS; each row names its probe, built in T5):

  | Row | Requirement | Probe evidence |
  | --- | --- | --- |
  | R1 | Admin user set up | Mongo query: ≥1 user with `admin: true`; login as it returns a session; `GET /admin/config` 200 for admin, 403 for a member |
  | R2 | Secure auth | Better Auth enabled; no secret literal in tracked files (`.env` untracked, `.env.example` placeholders only); unauthenticated `GET /todos` 401; rate limit not disabled; password under 8 chars rejected; on the deployed app the template's seeded `admin@example.com` / `testpassword123` login fails (password rotated via a deploy-time env var) |
  | R3 | Theme applied, visual quality | `constants/theme.ts` differs from the scaffold's; scorer judges desktop and mobile screenshots of login, todo list and admin (score ≥ 4/5) |
  | R4 | Works on desktop and mobile | Playwright at 1280×800 and 390×844: no horizontal scroll, primary actions visible, todo create works at both sizes |
  | R5 | GPT setup works | `POST /gpt/prompt` streams a non-empty reply with the configured provider key; an `AIRequest` row is written |
  | R6 | Consent forms present | A consent form exists and is shown to a fresh user before the todo screen; accepting records a consent response |
  | R7 | New features present | Todo create, edit, complete, delete, due date and an all/active/done filter, owner-scoped and synced (Q6) |
  | R8 | Roles work | Member cannot reach admin routes (403) or another user's todo (403/404); admin can; the template's seeded RBAC roles (`access.roles.seedDefaults()`, `operator`, `org-admin`) exist and the admin holds `org-admin` (Q5) |
  | R9 | GitHub Actions and CircleCI green with coverage | Latest run on the build's branch is `success` on both hosts (`gh run list`, CircleCI API v2) and each uploads or prints a coverage report |
  | R10 | AI tooling wired up | `.rulesync/` sources plus generated `CLAUDE.md`/`AGENTS.md`, `.mcp.json` naming `terreno-local`, `terreno info` runs in the app |
  | R11 | `CHECKLIST.md` for the user | File at the app root with unchecked items covering secrets, deploy, admin password change, consent text review |
  | R12 | Initial user seeded | Seed script exists and a non-admin user can log in after a fresh `seed` |
  | R13 | App deployed | Deployed web URL returns 200, a deep link loads on refresh, login works against the deployed backend |
  | T | Time | Wall-clock minutes per stage and total; flagged when a stage or the total is >25% and >2 min slower than the previous version's (not a pass/fail row, but listed as a regression) |

- **Builder and scorer processes.** Agent stages run `BOOTSTRAP_LOOP_BUILDER_CMD` (default
  `claude -p --output-format json --permission-mode bypassPermissions`) in the app directory
  with the stage prompt on stdin and an env allowlist: every stage gets `PATH`, `HOME`, the AI
  key the builder model needs and `BOOTSTRAP_LOOP_*` non-secret settings; only `ai` gets the app
  AI key, only `ci` gets `CIRCLECI_TOKEN` and a GitHub token, only `deploy` gets the deploy and
  database variables. The GitHub token given to `ci` is a fine-grained token scoped to the run
  repo (`BOOTSTRAP_LOOP_GH_TOKEN`), never the session's `gh` login. The scorer runs `BOOTSTRAP_LOOP_SCORER_CMD` (default
  `claude -p --output-format json --allowedTools Read,Glob,Grep`) in the evidence directory: a
  new session per score, never `--resume`, no builder transcript. Both are env-overridable so
  tests use fakes.
- **Where outputs go.** Run directories live outside the repo (`$BOOTSTRAP_LOOP_HOME`,
  default `/data/bootstrap-loop/<runId>`). Committed: `docs/bootstrapLoop/runs/<version>/`
  (`score.json`, `SCORE.md`, `ITERATIONS.md`, `build.json`) and `docs/bootstrapLoop/REGRESSIONS.md`.
  Uploaded: `/opt/cursor/artifacts/bootstrap-loop/<runId>/` with the app tarball (no
  `node_modules`, no `.env`), screenshots and the same reports. The PR (Brew) carries the
  skill, runner and committed reports.

## Tasks

- [ ] **T1** — Run the scaffold stage alone: the builder follows that version's bootstrap prompt and the runner writes a stage JSON
  - Depends on: none
  - Files: scripts/bootstrapLoop/cli.ts, scripts/bootstrapLoop/commands/stage.ts, scripts/bootstrapLoop/types.ts, scripts/bootstrapLoop/stages.ts, scripts/bootstrapLoop/runStage.ts, scripts/bootstrapLoop/stageResult.ts, scripts/bootstrapLoop/agent.ts, scripts/bootstrapLoop/redact.ts, scripts/bootstrapLoop/bootstrapPrompt.ts, scripts/bootstrapLoop/stages/scaffold.ts, scripts/bootstrapLoop/fixtures/fakeBuilder.ts, scripts/bootstrapLoop/runStage.test.ts, scripts/bootstrapLoop/bootstrapPrompt.test.ts, scripts/bootstrapLoop/redact.test.ts, scripts/bootstrapLoop/e2e/stage.e2e.test.ts, package.json
  - Criteria: `cli.ts` dispatches to `commands/<name>.ts`, discovered from the `commands/` directory at startup, so later tasks add a command file and never edit `cli.ts`. `bun run bootstrap-loop stage scaffold --version <v|local> --run-dir <dir>` renders that version's `terreno_bootstrap` prompt (Architecture decisions), pipes `<naive prompt> + <bootstrap prompt>` to `BOOTSTRAP_LOOP_BUILDER_CMD` in `<dir>/app`, then pins Terreno deps to exactly `<v>`, installs, type-checks the backend, runs `git init` and one commit in `<dir>/app` (the baseline later stages diff against), and writes `<dir>/stages/scaffold.json`. Logs pass through the redactor. Unknown stage ids fail with exit 2.
  - Seam: the `bootstrap-loop` CLI (child process) and exported `runStage({stageId, version, runDir, failures?})`, `renderBootstrapPrompt({version, appName, appDisplayName})`, `redact(text, env)`
  - Interface: `runStage(...)` → `Promise<StageResult>` where `StageResult = {stage: string, version: string, status: "PASS" | "FAIL", attempt: number, startedAt: string, endedAt: string, minutes: number, checks: {name: string, status: "PASS" | "FAIL", ev: string}[], log: string}` (ISO timestamps via Luxon, `minutes` rounded to 0.1); written to `<runDir>/stages/<stage>.json`; a rerun increments `attempt` and keeps the previous file as `<stage>.<attempt>.json`; `failures` are appended to the builder prompt under `## Fix these failures`; the builder's stdout tail (last 200 lines, redacted) goes to `log`
  - Cases:
    - fake builder that runs `terreno bootstrap app --terreno-path <checkout>` (what the local prompt asks) → `stage scaffold --version local --run-dir T` exit 0; `T/stages/scaffold.json` `status: "PASS"`, `attempt: 1`, check `backend-typecheck` PASS; `T/app/backend/package.json` exists
    - the prompt the fake builder received (echoed to a file) contains `make me a todo app`; for `58.0.6` it contains `bunx create-terreno-app`; for `local` it contains `--terreno-path <checkout>` and no bare `bunx create-terreno-app`
    - after the stage `T/app` is a git repo with exactly one commit (`git rev-list --count HEAD` = 1)
    - same command again → `attempt: 2`, `T/stages/scaffold.1.json` exists
    - after the stage, every `@terreno/*` dependency in `T/app/backend/package.json` and `T/app/frontend/package.json` is an exact version (no `^`/`~`); with `--version 58.0.6` (fake builder writing `^58.0.6` deps from a fixture) they read `58.0.6`
    - `renderBootstrapPrompt` for `57.4.0` (no `@terreno/mcp/bootstrap` export) and `58.0.6` both return text containing `create-terreno-app` and `terreno_bootstrap_ai_rules`; for `0.31.0` it returns text naming `terreno_bootstrap_app` (registry fetch; skipped offline with a logged reason)
    - `stage nope` → exit 2, stderr names the valid stage ids
    - fake builder exits 3 → exit 1, `status: "FAIL"`, ev contains `builder exited 3`
    - type-check failure (fake builder injects a TS error) → exit 1, failing check `ev` holds the tsc output tail
    - the fake builder records its env: for `stage scaffold` it lacks `CIRCLECI_TOKEN`, `VERCEL_TOKEN`, `GH_TOKEN`, `BOOTSTRAP_LOOP_MONGO_URI`
    - `redact` replaces a value found in `app/backend/.env` (`BETTER_AUTH_SECRET=s3cr3t` → `[redacted]`) and the password in `mongodb://u:p@host`
    - `redact("token abc123", {GH_TOKEN: "abc123"})` → `token [redacted]`; a value of a var not matching the secret-name patterns is left alone; empty values are not replaced
  - Blast radius: T2, T4, T5, T6, T7 read stage JSON → their tests use the `StageResult` type from `types.ts`
  - Test skills: none (bun test at the script seam; follow `scripts/regression/checkSuites.test.ts` style)

- [ ] **T2** — Run each of the ten later stages through the builder with stage-specific checks
  - Depends on: T1
  - Files: scripts/bootstrapLoop/stages.ts, scripts/bootstrapLoop/stages/checks.ts, scripts/bootstrapLoop/stages/checks.test.ts, scripts/bootstrapLoop/agentStages.test.ts, .rulesync/skills/bootstrap-todo-loop/references/stages/auth.md, .rulesync/skills/bootstrap-todo-loop/references/stages/admin.md, .rulesync/skills/bootstrap-todo-loop/references/stages/theming.md, .rulesync/skills/bootstrap-todo-loop/references/stages/features.md, .rulesync/skills/bootstrap-todo-loop/references/stages/roles.md, .rulesync/skills/bootstrap-todo-loop/references/stages/consent.md, .rulesync/skills/bootstrap-todo-loop/references/stages/ai.md, .rulesync/skills/bootstrap-todo-loop/references/stages/ci.md, .rulesync/skills/bootstrap-todo-loop/references/stages/deploy.md, .rulesync/skills/bootstrap-todo-loop/references/stages/checklist.md
  - Criteria: the registry lists the eleven stages in the order of the Architecture decisions table. Each later stage pipes `<naive prompt> + <stage prompt> + <prior failures, if any>` to the builder (T1's executor), then runs that stage's deterministic checks (file presence, backend type-check, frontend type-check); rubric probes run only at scoring (T5/T6). Builder exit ≠ 0 or any failing check → `FAIL`. Every stage prompt states it needs no human input and names the Terreno skills/docs to read; `roles.md` covers the template's seeded RBAC roles; `deploy.md` rotates the seeded admin password via env.
  - Seam: exported `runStage` for the ten ids, with `BOOTSTRAP_LOOP_BUILDER_CMD` set to the fake builder
  - Interface: same `StageResult` as T1
  - Cases:
    - fake builder writes `CHECKLIST.md` with 5 `- [ ]` items → `stage checklist` PASS
    - fake builder exits 0 but writes nothing → `stage checklist` FAIL, check `checklist-file` ev `CHECKLIST.md missing`
    - `failures: ["R6: no consent form"]` on `stage consent` → the prompt the fake builder received contains `## Fix these failures` and `R6: no consent form`
    - registry order is exactly scaffold, auth, admin, theming, features, roles, consent, ai, ci, deploy, checklist
    - every `references/stages/<id>.md` exists for the ten ids and contains the phrase `no human input`
  - Blast radius: T3 names these stages; T4 iterates the registry → T4's E2 asserts order
  - Test skills: none

- [ ] **T3** — Add the bootstrap-todo-loop skill that turns "make me a todo app" into a staged build
  - Depends on: T2
  - Files: .rulesync/skills/bootstrap-todo-loop/SKILL.md, .rulesync/skills/bootstrap-todo-loop/references/rubric.md, scripts/bootstrapLoop/skill.test.ts, .claude/skills/bootstrap-todo-loop/ (generated by `bun run rules`), other rulesync-generated copies
  - Criteria: the skill sits beside `build-terreno-app` in `.rulesync/skills/` (repo-only harness), opens with the literal naive prompt `make me a todo app`, says it asks no further questions, tells the agent to run `bun run bootstrap-loop loop --version <v>` (or one `stage`), and points at the rubric. `bun run rules:check` passes.
  - Seam: the generated skill files
  - Interface: none (prose)
  - Cases (in `skill.test.ts`, reading `.rulesync/skills/bootstrap-todo-loop/SKILL.md`):
    - contains the literal `make me a todo app`
    - contains every stage id from the registry export
    - contains `no further questions` and `bun run bootstrap-loop loop`
    - `references/rubric.md` contains every row id R1–R13
    - `bun run rules:check` exits 0 (roast)
  - Blast radius: none
  - Test skills: update-agent-docs

- [ ] **T4** — Build the whole app by running every stage in order with timings
  - Depends on: T2
  - Files: scripts/bootstrapLoop/build.ts, scripts/bootstrapLoop/commands/build.ts, scripts/bootstrapLoop/build.test.ts, scripts/bootstrapLoop/e2e/build.e2e.test.ts
  - Criteria: `bun run bootstrap-loop build --version <v> --run-dir <dir> [--from <stage>] [--only <a,b>]` runs the registry in order, stops at the first `FAIL` unless `--keep-going`, and writes `<dir>/build.json` = `{version, stages: {id, status, attempts, firstPassMinutes, totalMinutes}[], totalMinutes, startedAt, endedAt}`; a stage's `totalMinutes` is the sum of all its attempts' `minutes` in this run dir.
  - Seam: the CLI (child process) and exported `runBuild(...)`
  - Interface: `runBuild({version, runDir, from?, only?, keepGoing?})` → `Promise<BuildResult>` (shape above); exit 0 when every run stage passed, 1 otherwise
  - Cases:
    - fake builder that always succeeds → 11 stage files, `build.json.stages` ids in registry order, `totalMinutes` = sum of stage `totalMinutes` ±0.1
    - a run dir where `roles` already has attempts of 4.0 and 3.0 minutes → its entry reads `attempts: 2`, `firstPassMinutes: 4`, `totalMinutes: 7`
    - fake builder failing on `roles` → stages after `roles` absent, exit 1
    - same with `--keep-going` → all 11 present, `roles` FAIL, exit 1
    - `--from consent` on a run dir with passing earlier stages → only consent..checklist rerun; earlier files untouched (mtime unchanged)
    - `--only ai,deploy` → exactly those two run
  - Blast radius: T6 reads `build.json` for time comparison; T7 reruns via `only`
  - Test skills: none

- [ ] **T5** — Collect rubric evidence with deterministic probes
  - Depends on: T1
  - Files: scripts/bootstrapLoop/score/probes/*.ts, scripts/bootstrapLoop/score/collectEvidence.ts, scripts/bootstrapLoop/score/probes.test.ts, scripts/bootstrapLoop/fixtures/apps/
  - Criteria: `collectEvidence({runDir})` starts the app's backend and web against a replica-set Mongo, runs the probe for each row R1–R13 in the rubric table, takes Playwright screenshots (login, todo list, admin) at 1280×800 and 390×844, and writes `<runDir>/evidence/evidence.json` (`{row, status: "PASS" | "FAIL" | "UNKNOWN", facts: string[], artifacts: string[]}` per row) plus the PNGs. A probe that lacks a credential (no deploy URL, no AI key, no CI remote) reports `UNKNOWN` with the missing variable named, never PASS.
  - Seam: exported probe functions and `collectEvidence`
  - Interface: `probeR<n>({appDir, env, baseUrl, webUrl})` → `Promise<RowEvidence>`
  - Cases:
    - fixture app with a tracked `.env` holding `BETTER_AUTH_SECRET=abc` → R2 FAIL, fact names the file
    - fixture with no admin user → R1 FAIL; with one → PASS
    - no `CHECKLIST.md` → R11 FAIL; with 5 unchecked items → PASS
    - `DEPLOY_URL` unset → R13 UNKNOWN, fact `DEPLOY_URL not set`
    - AI key unset → R5 UNKNOWN; set with a stub provider server returning a stream → PASS and an `AIRequest` row
    - CI: stubbed `gh`/CircleCI responses success+success → R9 PASS; success+failed → FAIL; no coverage artifact → FAIL
  - Blast radius: T6 consumes `evidence.json` → T6 tests use its type
  - Test skills: terreno-backend-tests (Mongo setup for probes)

- [ ] **T6** — Score a build in a separate session and flag time regressions
  - Depends on: T5
  - Files: scripts/bootstrapLoop/score/score.ts, scripts/bootstrapLoop/score/scorerPrompt.md, scripts/bootstrapLoop/score/timeRegression.ts, scripts/bootstrapLoop/score/score.test.ts, scripts/bootstrapLoop/fixtures/fakeScorer.ts, scripts/bootstrapLoop/commands/score.ts
  - Criteria: `bun run bootstrap-loop score --run-dir <dir> [--previous <dir>]` runs T5's collector, then `BOOTSTRAP_LOOP_SCORER_CMD` as a new process in `<dir>/evidence` with the rubric and evidence only, and writes `score.json` = `{version, rows: {row, status, reason}[], pass: boolean, visualScore: number, times: {stages: {id, totalMinutes, previous?, regressed}[], scoreMinutes, totalMinutes, previousTotal?, totalRegressed}}` and a readable `SCORE.md`. A row is PASS only when the probe said PASS and the scorer agrees; UNKNOWN counts as fail. Time regression compares each stage's `totalMinutes` (all attempts): `now > previous * 1.25 && now - previous > 2`. `score.json` also keeps `evidenceRefs`: the CI run URLs and IDs, the deploy URL with the HTTP status and timestamp of the R13 probe, and screenshot paths, copied from `evidence.json`.
  - Seam: exported `scoreBuild(...)` and the `score` CLI
  - Interface: as above; the scorer's stdout must be JSON `{rows: {row, status, reason}[], visualScore}`; malformed output → every row FAIL with reason `scorer output unparsable`
  - Cases:
    - all probes PASS, fake scorer agrees, R3 visualScore 4 → `pass: true`
    - probe PASS, scorer says FAIL for R3 → `pass: false`, R3 reason from scorer
    - probe UNKNOWN R13 → R13 FAIL regardless of scorer
    - previous `ai` 10 min, now two attempts of 8 + 5 = 13 → regressed (sum over attempts)
    - previous `ai` 10 min, now 13 → regressed (30%, +3); previous 4, now 5.5 → not (37% but +1.5); total 60 → 76 → `totalRegressed: true`
    - scorer gets no builder log: the fake scorer records its cwd and env; cwd is `<dir>/evidence`, and no file under it matches `stages/*.json` `log` content
  - Blast radius: T7 reads `score.json.pass` and failing rows; T8 reads `times`
  - Test skills: none

- [ ] **T7** — Rerun failing stages and rescore until the rubric passes or iterations run out
  - Depends on: T4, T6
  - Files: scripts/bootstrapLoop/loop.ts, scripts/bootstrapLoop/loop.test.ts, scripts/bootstrapLoop/commands/loop.ts
  - Criteria: `bun run bootstrap-loop loop --version <v> [--max-iterations N]` (default 3; Q3) runs `build`, then `score`; while `pass` is false and iterations remain, maps each failing row to its owning stage (table above), reruns those stages with the failing rows' reasons as `failures`, and rescores. Each iteration appends to `<runDir>/iterations.jsonl` and `ITERATIONS.md`: `{iteration, failedRows, rerunStages, changedFiles (git diff --stat in the app), score: {passCount, total}, minutes}`. Exit 0 on pass, 1 when exhausted.
  - Seam: exported `runLoop(...)`
  - Interface: `runLoop({version, runDir, maxIterations, previousRunDir?})` → `Promise<{pass: boolean, iterations: IterationLog[]}>`
  - Cases:
    - scorer fails R6 once, then passes → 2 iterations; iteration 2 reran only `consent`; exit 0
    - scorer always fails R9 with max 3 → 3 log entries, exit 1, last entry lists R9
    - R1 and R12 failing → `admin` rerun once (deduplicated)
    - the app dir is a git repo after scaffold; `changedFiles` lists files the fake builder touched
  - Blast radius: T8 calls `runLoop` per version
  - Test skills: none

- [ ] **T8** — Run the loop for every minor version and report regressions between versions
  - Depends on: T7
  - Files: scripts/bootstrapLoop/matrix/versions.ts, scripts/bootstrapLoop/matrix/diff.ts, scripts/bootstrapLoop/matrix/matrix.ts, scripts/bootstrapLoop/matrix/report.ts, scripts/bootstrapLoop/matrix/*.test.ts, scripts/bootstrapLoop/commands/matrix.ts
  - Criteria: `bun run bootstrap-loop matrix [--versions a,b] [--from-version <v>] [--include-local]` lists versions from the npm registry (latest patch per minor at or above `--from-version`, default `57.4.0` plus the extra versions Q2 settles (recommended `0.31.x` and `57.3.x`, reported as a separate stack), excluding prereleases; for versions below 57.4.0 it lists `@terreno/mcp` instead, since `create-terreno-app` did not exist), runs `runLoop` per version in ascending order with the previous version as `previousRunDir`, and writes `docs/bootstrapLoop/REGRESSIONS.md` plus `docs/bootstrapLoop/runs/<version>/{score.json,SCORE.md,ITERATIONS.md,build.json}`. A regression is a rubric row PASS at version N−1 and FAIL at N (after iterations), a row needing more iterations than at N−1, a time regression, or a scaffold file-tree change that removes a file the previous version had. The report has one table per version pair and a "Fixed at HEAD" column (filled by T11).
  - Seam: exported `listVersions(registryJson)`, `diffRuns(prev, next)`, `runMatrix(...)`
  - Interface: `listVersions` → ascending `string[]`; `diffRuns` → `{rowRegressions, iterationRegressions, timeRegressions, removedFiles}`
  - Cases:
    - registry versions `57.3.9, 57.4.0, 57.4.2, 57.5.0, 58.0.0-beta.1, 58.0.6` → `["57.4.2", "57.5.0", "58.0.6"]`
    - prev R6 PASS, next R6 FAIL → one row regression naming R6 and both versions
    - prev 1 iteration, next 3 → iteration regression
    - prev tree has `frontend/app/signup.tsx`, next lacks it → `removedFiles` lists it
    - `--versions 57.20.1,58.0.6` runs exactly those two with a fake loop
  - Blast radius: none (report only)
  - Test skills: none

- [ ] **T9** — Upload run outputs and tear down a run's external resources
  - Depends on: T7
  - Files: scripts/bootstrapLoop/upload.ts, scripts/bootstrapLoop/upload.test.ts, scripts/bootstrapLoop/teardown.ts, scripts/bootstrapLoop/teardown.test.ts, scripts/bootstrapLoop/commands/upload.ts, scripts/bootstrapLoop/commands/teardown.ts
  - Criteria: `bun run bootstrap-loop upload --run-dir <dir>` copies the app as `app.tar.gz` (excluding `.env*`, `.vercel/`, `node_modules`, `.git`), screenshots, `evidence.json`, `score.json`, `SCORE.md`, `ITERATIONS.md`, `build.json` and, when present, `REGRESSIONS.md` into `/opt/cursor/artifacts/bootstrap-loop/<runId>/` (`BOOTSTRAP_LOOP_ARTIFACTS` overrides), every text file through T1's redactor. `bun run bootstrap-loop teardown --run-dir <dir>` deletes that run's deploy, database and CI branch through the commands the deploy stage recorded in `<dir>/deploy.json`, refusing (exit 2) on a run dir marked `keep: true`.
  - Seam: exported `uploadRun(...)`, `teardownRun(...)`
  - Interface: `uploadRun({runDir, dest})` → `Promise<{files: string[]}>`; `teardownRun({runDir})` → `Promise<{removed: string[]}>`
  - Cases:
    - run dir with `app/node_modules/x`, `app/backend/.env`, `app/frontend/.env.local`, `app/.vercel/project.json` → tarball lacks all four
    - dest missing → created
    - missing `score.json` → exit 1 naming it
    - a `log` containing the value of `VERCEL_TOKEN` from env → the uploaded `stages/*.json` holds `[redacted]` instead
    - `teardown` on a run dir with `keep: true` → exit 2; without it, the fake teardown command receives the deploy id, database name and branch name from `deploy.json`
  - Blast radius: none
  - Test skills: none

- [ ] **T12** — Document the harness and run its tests in CI
  - Depends on: T8, T9
  - Files: package.json, .circleci/config.yml, .github/workflows/bootstrap-app-check.yml, docs/reference/bootstrap-loop.md, docs/how-to/run-bootstrap-loop.md, docs/reference/README.md, docs/reference/create-terreno-app.md
  - Criteria: root `test:bootstrap-loop` runs `bun test scripts/bootstrapLoop/` excluding `e2e/`, and CircleCI runs it when `scripts/bootstrapLoop/**` changes (GitHub Actions parity per `check:circleci-parity`). `test:bootstrap-loop:e2e` runs `e2e/` as a step in `bootstrap-app-check.yml`, whose `pull_request.paths` gains `scripts/bootstrapLoop/e2e/**` and `scripts/bootstrapLoop/stages/scaffold.ts` (so PRs touching the real scaffold path run it; others get it weekly and on tags). Docs describe the stage contract, CLI commands, rubric, env vars and allowlists, and how to run one stage, a full loop, the matrix, upload and teardown.
  - Seam: package scripts and CI config
  - Interface: none
  - Cases: none (untestable as behavior: config and prose; roast runs `bun run test:bootstrap-loop`, `bun run check:circleci-parity`, and checks each CLI command named in the docs exists under `commands/`)
  - Blast radius: none
  - Test skills: update-docs

- [ ] **T10** — Demonstrate a single-stage run and a full loop on the latest version to a green rubric
  - Depends on: T9, T12, and the Q1 answer (accounts and keys in the session env); without it the stage ends BLOCKED naming the missing variables
  - Files: docs/bootstrapLoop/runs/<latest>/*, docs/bootstrapLoop/runs/single-stage-demo.md, fixes in scripts/bootstrapLoop/ or create-terreno-app/ or mcp-server/src/bootstrap.ts found by the run
  - Criteria: one `stage auth` run on an existing scaffold recorded in `single-stage-demo.md` (command, stage JSON); one `loop --version <latest published>` whose committed `score.json` has `pass: true` with every R1–R13 row PASS; outputs uploaded with T9's command. Any harness or template fix carries its own unit test.
  - Seam: committed run outputs
  - Interface: `docs/bootstrapLoop/runs/<latest>/score.json` per T6
  - Also commits `evidence.json` and the screenshots beside `score.json`; the latest version's deploy is kept up (`keep: true`).
  - Cases: none (untestable as a unit: an operational run; roast checks the committed `score.json` and `evidence.json`, that each CI run URL resolves to a `success` run via `gh run view` / the CircleCI API, that the deploy URL returns 200 now, and the uploaded artifact paths)
  - Blast radius: none
  - Test skills: verify-ui-changes (screenshots)

- [ ] **T11** — Run the version matrix, note every regression, and fix the ones still present at HEAD
  - Depends on: T10, T8, and the Q1 and Q2 answers
  - Files: docs/bootstrapLoop/REGRESSIONS.md, docs/bootstrapLoop/runs/*/, docs/bootstrapLoop/runs/local/, fixes in create-terreno-app/, mcp-server/src/bootstrap.ts, docs/
  - Criteria: `matrix` executed over every version T8 lists; `REGRESSIONS.md` lists each regression with the version that introduced it; matrix outputs are uploaded with `upload` and non-latest deploys torn down; each regression that still reproduces on `local` is fixed in the template or bootstrap prompt with a test and marked "Fixed at HEAD"; ones confined to published versions are marked "Published only — cannot fix" (Q4). After the fixes, `loop --version local` reaches `pass: true` and its outputs are committed as `docs/bootstrapLoop/runs/local/` beside the latest published version's.
  - Seam: committed report
  - Interface: `REGRESSIONS.md` per T8
  - Cases: none (untestable as a unit: operational; each fix's own test is written with that fix)
  - Blast radius: a template fix changes generated apps → `create-terreno-app` generate tests and `scripts/ci/check-bootstrap-app.sh`
  - Test skills: terreno-backend-tests, terreno-frontend-tests

## Assumptions

- "The existing bootstrap terreno skill" is the `terreno_bootstrap` MCP prompt
  (`mcp-server/src/bootstrap.ts`) plus the `create-terreno-app` template it runs; no skill has
  that exact name, and `build-terreno-app` is the public-docs dogfood harness, not a bootstrap.
- The new skill lives in `.rulesync/skills/bootstrap-todo-loop/` beside `build-terreno-app`:
  it is a repo-only regression harness, so it belongs in this repo even though shared app
  skills moved to TerrenoLabs/terreno-skills (#1712).
- The harness is root-level scripts (`scripts/bootstrapLoop/`), like `scripts/regression/`,
  not a new workspace package.
- The scorer and builder default to the `claude` CLI on PATH; `codex` can be swapped in via
  the env commands.
- AI provider for R5: whichever key is supplied (Gemini via `@ai-sdk/google`, the provider the
  `@terreno/ai` docs use, or OpenAI); the `ai` stage wires the one whose key exists.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 (fundamental) | The rubric needs external accounts this sandbox lacks: it has only `gh` and `CIRCLECI_TOKEN`, with no deploy credentials, no database for a deployed backend and no AI key. Which accounts may the builds use, and where should they deploy? | Create one private repo, `TerrenoLabs/bootstrap-todo-runs`, with one branch per version and one CircleCI project followed once. Deploy Vercel previews (web plus backend Functions, via the `deploy-vercel` skill) against one MongoDB Atlas replica set with one database per version. Use a Gemini key. Add `VERCEL_TOKEN`, `BOOTSTRAP_LOOP_MONGO_URI` and `GOOGLE_GENERATIVE_AI_API_KEY` to the session env. Tear down non-latest deploys after scoring. | R5, R9 and R13 can't pass without them, and creating repos and deploys is an external commitment. Vercel over Cloud Run because previews are per branch and need no per-version infra. Cloud Run (`deploy-gcp`, the template's `Dockerfile`) is where Flourish runs, but it would need ~20 services and `GCP_SA_TERRENO`, which this session lacks. | Cloud Run swaps the `deploy` and `ci` stage prompts, the R13 probe and teardown. One repo per version multiplies repos by 20. With no credentials, R5, R9 and R13 stay UNKNOWN, and T10/T11 end BLOCKED. | T2, T5, T9, T10, T11 |
| Q2 (fundamental) | Does "every minor and every major version" include major 0 (0.0–0.31) and 57.0–57.3? Their `terreno_bootstrap` prompt exists but scaffolds through the MCP tool `terreno_bootstrap_app` on the legacy RTK/JWT stack, not through `create-terreno-app`. | Partly. Run every minor from 57.4 (the first `create-terreno-app`) to the newest 58.x (~20 versions), plus `local`. Add 0.31 (the last version of major 0) and 57.3 (the last pre-template 57), so every major runs at least once. Report those two as a different stack, outside the regression diff. | Builds before 57.4 use a different scaffold and stack, so diffing them against 57.4+ would show the stack change, not regressions. One build per older line meets "every major" for two builds. The request names this exact ambiguity as an inbox question. | **All of 0.x and 57.0–57.3** adds ~36 builds, each needing that version's MCP server for `terreno_bootstrap_app` and JWT-stack probes for R2. **Template era only** drops the two extra builds and leaves major 0 untested. | T1, T5, T8, T11 |
| Q3 | Should every matrix version get the full agent loop (deploy, CI, up to 3 iterations), or should the full loop run on the latest and once per major, with older minors getting scaffold plus deterministic probes only? | Run the full loop on every version as requested, with `--max-iterations 3`. The latest may go to 5 to reach green. | The request says every build in the matrix goes through the same test-and-score loop. | The cheaper option gives T8 a `--depth probes` mode for older minors, and the report marks their agent rows "not run". | T7, T8, T11 |
| Q4 | Published versions can't be fixed (npm is immutable). Should we fix only the regressions that still reproduce at HEAD? | Yes. Fix them at HEAD with a test, and note the published-only ones. | The request says "fix what you can". | Backporting to old minors adds a release task per minor. | T11 |
| Q5 | Which roles must "roles work" cover? | Admin (`user.admin`) and member, plus the RBAC roles the template seeds (`access.roles.seedDefaults()`, `operator`, `org-admin`), each checked for the access it grants. | The template already ships these. Nothing in the request names more. | A new role, such as read-only staff, adds RBAC work to the `roles` stage and a probe case. | T2, T5 |
| Q6 | Which "new features" make the todo app complete, so runs stay comparable? | A fixed spec in the `features` prompt: create, edit, complete, delete, due date, and an all/active/done filter; owner-scoped and synced via syncdb. | A naive prompt gives no spec, and a fixed one lets versions be diffed. | A different list changes only the `features` prompt and the R7 probe. | T2, T5 |
| Q7 | Should "works on mobile" be judged on mobile-width web or on a native emulator? | Mobile-width web (Playwright at 390×844). | Native builds for ~20 versions need EAS or Gradle each time, and the emulator companion is on demand and slow. | Native adds a Maestro flow per build and the emulator to every run (X2). | T5 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Scheduled CI job that runs `loop --version local` weekly, replacing or extending `bootstrap-app-check.yml` | Catching regressions per release without a human starting the run | M | T10, Q1 |
| X2 | Native (Android emulator / iOS) scoring with Maestro | "Mobile" could mean native | L | Q7 |
| X3 | Vary the naive driver skill and stage prompts per version too | "Versions of the bootstrap skill" could include the prompts this plan adds | S | T8 |
| X4 | More app concepts than todo (reuse `build-terreno-app` concepts) | Same harness fits any concept | M | T7 |

## Decisions

None.

## Sign-off

Status: awaiting sign-off (2026-11-14)
Cut: 2 rounds, 23 findings: 21 fixed, 2 moved to questions or expansions, 0 rebutted, 0 blocking open
