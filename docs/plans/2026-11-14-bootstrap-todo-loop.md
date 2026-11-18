# Bootstrap todo loop: staged, self-scoring regression harness for the bootstrap template

Terreno ships a bootstrap path (the `terreno_bootstrap` MCP prompt, which runs
`create-terreno-app`, then `terreno_bootstrap_ai_rules`) and a dogfooding skill
(`build-terreno-app`), but nothing builds the same app the same way on every release and
says what got worse. A weekly CI job (`bootstrap-app-check.yml`) only proves the scaffold
compiles. This plan adds a repeatable loop: a deliberately naive prompt ("make me a todo
app") drives the bootstrap through eleven named stages, a separate agent session scores the
result against a fixed rubric and against the previous version's timings, failing stages are
rerun until the rubric passes or iterations run out, and the whole thing runs once per 58.x
release of the template (D2, D8). Terreno maintainers feel the difference: a regression in the
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
| T8 | Version matrix (58.x releases + `local`), output diff, regression report | T7 | `scripts/bootstrapLoop/matrix/` | `bun test` with a fake registry |
| T9 | Artifact upload with redaction, teardown | T7 | `scripts/bootstrapLoop/upload.ts`, `teardown.ts` | `bun test` |
| T12 | Docs and CI wiring of the harness tests | T8, T9 | `docs/`, `.circleci/`, `bootstrap-app-check.yml` | `bun run test:bootstrap-loop`, `bun run check:circleci-parity` |
| T10 | Real runs: one single-stage run, one full loop on the latest version to a green rubric | T9, T12, D1 | `docs/bootstrapLoop/runs/<version>/` | committed `score.json` all rows PASS |
| T11 | Real matrix across every version (D2, D8), regressions found, noted and fixed at HEAD where possible | T10, T8, D1 | `docs/bootstrapLoop/REGRESSIONS.md`, fixes | committed report + fix PR commits |

Tracer: the `scaffold` stage run alone, the builder following that version's bootstrap prompt, (`bun run bootstrap-loop stage scaffold --version local`) writes a valid stage JSON and a scaffolded app.
E2E: 2 specs (process): the single-stage CLI run and the full `build` with a fake builder.
Regression: None — no hard-to-automate change; the loop itself is the automated check.
User guide: None — no change to what example-app users see or do.
Design: None — no canvas; the built app's look is judged by the scorer's visual rubric row.
Out of scope: X1 scheduled CI run of the matrix, X2 native-device scoring, X3 varying the driver skill per version, X4 other app concepts, X5 pre-58 versions (see Expansions).
Open risks: the Vercel, Atlas and Gemini credentials (D1) must be in the session env before T10, or R2's deploy check, R5, R9 and R13 stay UNKNOWN and T10 ends BLOCKED naming the missing variables; 8 full agent builds cost real time and money (D3); published template versions are immutable, so old-version regressions can only be noted, not fixed (D4).
Elephant: the full matrix is 8 agent builds (58.0.0–58.0.6 plus `local`) × up to 3 iterations, likely 8–24 wall-clock hours and a few hundred dollars of model spend, and every build creates a deploy and two CI runs on external services.

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

- **Versions under test (D2, D8).** Major 58 and up only. Today the only 58 minor is 58.0
  (tags 58.0.0–58.0.6), so the matrix runs every stable 58.x release, patches included
  (58.0.0, 58.0.1, …, 58.0.6, prereleases excluded), plus `local` (this checkout) last, so
  each adjacent pair can be diffed. When 58.1+ or 59 ship, the same rule keeps every stable
  release from 58.0.0. Nothing below 58.0.0 is run (X5).
- **The scaffold stage drives the bootstrap prompt.** `scaffold` is an agent stage: the
  builder receives the naive prompt plus that version's `terreno_bootstrap` prompt text and
  carries out the prompt's own steps (`create-terreno-app`, `terreno_bootstrap_ai_rules`,
  rulesync generate). The prompt text is rendered by installing `@terreno/mcp@<v>` into a temp
  dir and importing its `@terreno/mcp/bootstrap` export (present in every 58.x), then calling
  `handlePromptRequest("terreno_bootstrap", {appName, appDisplayName})`; for `local` it comes
  from this checkout's `mcp-server`, and the runner rewrites its `bunx create-terreno-app …`
  line to `bun <checkout>/cli/dist/bin.js bootstrap app … --terreno-path <checkout>` so the
  builder scaffolds HEAD, not the published template. The builder's `.mcp.json` points at `@terreno/mcp@<v>` so
  the prompt's tool calls hit that version. After the builder, the stage pins every
  `@terreno/*` and `create-terreno-app`-written Terreno dependency to exactly `<v>` (the
  template writes caret ranges, `create-terreno-app/src/generate.ts:12`, which would otherwise
  resolve every 58.x build to the newest 58.x), installs, and type-checks. The naive driver
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
  | R7 | New features present | Todo create, edit, complete, delete, due date and an all/active/done filter, owner-scoped and synced (D6) |
  | R8 | Roles work | Member cannot reach admin routes (403) or another user's todo (403/404); admin can; the template's seeded RBAC roles (`access.roles.seedDefaults()`, `operator`, `org-admin`) exist and the admin holds `org-admin` (D5) |
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
    - `renderBootstrapPrompt` for `58.0.0` and `58.0.6` both return text containing `create-terreno-app` and `terreno_bootstrap_ai_rules` (registry fetch; skipped offline with a logged reason); `renderBootstrapPrompt` for `57.4.0` throws `version below 58.0.0 not supported`
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
  - Criteria: `bun run bootstrap-loop loop --version <v> [--max-iterations N]` (default 3; D3) runs `build`, then `score`; while `pass` is false and iterations remain, maps each failing row to its owning stage (table above), reruns those stages with the failing rows' reasons as `failures`, and rescores. Each iteration appends to `<runDir>/iterations.jsonl` and `ITERATIONS.md`: `{iteration, failedRows, rerunStages, changedFiles (git diff --stat in the app), score: {passCount, total}, minutes}`. Exit 0 on pass, 1 when exhausted.
  - Seam: exported `runLoop(...)`
  - Interface: `runLoop({version, runDir, maxIterations, previousRunDir?})` → `Promise<{pass: boolean, iterations: IterationLog[]}>`
  - Cases:
    - scorer fails R6 once, then passes → 2 iterations; iteration 2 reran only `consent`; exit 0
    - scorer always fails R9 with max 3 → 3 log entries, exit 1, last entry lists R9
    - R1 and R12 failing → `admin` rerun once (deduplicated)
    - the app dir is a git repo after scaffold; `changedFiles` lists files the fake builder touched
  - Blast radius: T8 calls `runLoop` per version
  - Test skills: none

- [ ] **T8** — Run the loop for every 58.x release and report regressions between versions
  - Depends on: T7
  - Files: scripts/bootstrapLoop/matrix/versions.ts, scripts/bootstrapLoop/matrix/diff.ts, scripts/bootstrapLoop/matrix/matrix.ts, scripts/bootstrapLoop/matrix/report.ts, scripts/bootstrapLoop/matrix/*.test.ts, scripts/bootstrapLoop/commands/matrix.ts
  - Criteria: `bun run bootstrap-loop matrix [--versions a,b] [--from-version <v>] [--no-local]` lists `create-terreno-app` versions from the npm registry: every stable release at or above `--from-version` (default and floor `58.0.0`; a lower value exits 2), prereleases excluded, ascending, then `local` last unless `--no-local`. It runs `runLoop` per version in that order with the previous version as `previousRunDir`, and writes `docs/bootstrapLoop/REGRESSIONS.md` plus `docs/bootstrapLoop/runs/<version>/{score.json,SCORE.md,ITERATIONS.md,build.json}`. A regression is a rubric row PASS at version N−1 and FAIL at N (after iterations), a row needing more iterations than at N−1, a time regression, or a scaffold file-tree change that removes a file the previous version had. The report has one table per version pair and a "Fixed at HEAD" column (filled by T11).
  - Seam: exported `listVersions(registryJson)`, `diffRuns(prev, next)`, `runMatrix(...)`
  - Interface: `listVersions` → ascending `string[]`; `diffRuns` → `{rowRegressions, iterationRegressions, timeRegressions, removedFiles}`
  - Cases:
    - registry versions `57.4.2, 57.5.0, 58.0.0-beta.1, 58.0.0, 58.0.1, 58.0.6` → `["58.0.0", "58.0.1", "58.0.6", "local"]`; with `--no-local` → `["58.0.0", "58.0.1", "58.0.6"]`
    - `--from-version 57.4.0` → exit 2 naming the `58.0.0` floor
    - prev R6 PASS, next R6 FAIL → one row regression naming R6 and both versions
    - prev 1 iteration, next 3 → iteration regression
    - prev tree has `frontend/app/signup.tsx`, next lacks it → `removedFiles` lists it
    - `--versions 58.0.1,58.0.6` runs exactly those two with a fake loop
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
  - Depends on: T9, T12, and `BOOTSTRAP_LOOP_GH_TOKEN` plus the private runs repo `TerrenoLabs/bootstrap-todo-runs` (R9 needs real CI runs); D9 drops the Vercel, Atlas and Gemini credentials from T10, so without the token and repo the stage ends BLOCKED naming them
  - Files: docs/bootstrapLoop/runs/<latest>/*, docs/bootstrapLoop/runs/single-stage-demo.md, fixes in scripts/bootstrapLoop/ or create-terreno-app/ or mcp-server/src/bootstrap.ts found by the run
  - Criteria: one `stage auth` run on an existing scaffold recorded in `single-stage-demo.md` (command, stage JSON); one `loop --version <latest published>` whose committed `score.json` has `pass: true` with every R1–R13 row PASS except R5, R13 and R2's deployed-login sub-check, which D9 records as `SKIPPED (descoped, D9)` and never counts as PASS; outputs uploaded with T9's command. Any harness or template fix carries its own unit test.
  - Seam: committed run outputs
  - Interface: `docs/bootstrapLoop/runs/<latest>/score.json` per T6
  - Also commits `evidence.json` and the screenshots beside `score.json`. D9 removes the kept-up deploy from T10.
  - Cases: none (untestable as a unit: an operational run; roast checks the committed `score.json` and `evidence.json`, that each CI run URL resolves to a `success` run via `gh run view` / the CircleCI API, that the deploy URL returns 200 now, and the uploaded artifact paths)
  - Blast radius: none
  - Test skills: verify-ui-changes (screenshots)

- [ ] **T11** — Run the version matrix, note every regression, and fix the ones still present at HEAD
  - Depends on: T10, T8, and the D1 credentials
  - Files: docs/bootstrapLoop/REGRESSIONS.md, docs/bootstrapLoop/runs/*/, docs/bootstrapLoop/runs/local/, fixes in create-terreno-app/, mcp-server/src/bootstrap.ts, docs/
  - Criteria: `matrix` executed over every version T8 lists; `REGRESSIONS.md` lists each regression with the version that introduced it; matrix outputs are uploaded with `upload` and non-latest deploys torn down; each regression that still reproduces on `local` is fixed in the template or bootstrap prompt with a test and marked "Fixed at HEAD"; ones confined to published versions are marked "Published only — cannot fix" (D4). After the fixes, `loop --version local` reaches `pass: true` and its outputs are committed as `docs/bootstrapLoop/runs/local/` beside the latest published version's.
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
| Q8 | "58 and up" leaves one minor (58.0) today. Should the matrix also run each 58.0.x patch, so there are version pairs to diff? | Yes: every stable 58.x release (58.0.0–58.0.6, 7 builds) plus `local`, recorded as D8. | One minor plus `local` gives only one pair, too few to say which release introduced a regression. | Latest patch per minor only: the matrix is 58.0.6 plus `local`, and T8's `listVersions` keeps only the newest patch per minor. | T8, T11 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Scheduled CI job that runs `loop --version local` weekly, replacing or extending `bootstrap-app-check.yml` | Catching regressions per release without a human starting the run | M | T10, D1 |
| X2 | Native (Android emulator / iOS) scoring with Maestro | "Mobile" could mean native | L | Q7 |
| X3 | Vary the naive driver skill and stage prompts per version too | "Versions of the bootstrap skill" could include the prompts this plan adds | S | T8 |
| X4 | More app concepts than todo (reuse `build-terreno-app` concepts) | Same harness fits any concept | M | T7 |
| X5 | Matrix builds for pre-58 versions (57.4–57.x on `create-terreno-app`; 0.x and 57.0–57.3 on the MCP `terreno_bootstrap_app` RTK/JWT stack) | The human limited the matrix to 58 and up | M | T8 |

## Decisions

Answered by the human on 2026-11-16.

| ID | Decision | Effect on the plan |
| --- | --- | --- |
| D1 (was Q1) | Vercel + Atlas + Gemini, as recommended: one private repo `TerrenoLabs/bootstrap-todo-runs` with a branch per version and CircleCI followed; Vercel previews (web plus Functions) against one MongoDB Atlas replica set with a database per version; a Gemini key. `VERCEL_TOKEN`, `BOOTSTRAP_LOOP_MONGO_URI`, `GOOGLE_GENERATIVE_AI_API_KEY` (and `BOOTSTRAP_LOOP_GH_TOKEN`) go in the session env; non-latest deploys are torn down. | As planned. |
| D2 (was Q2) | 58 and up only. | Differs from the recommendation: no 0.31 or 57.x builds, no separate stack, no MCP-tool scaffold path. Versions bullet, T1 prompt-render cases, and T8 floor and cases rewritten; pre-58 parked as X5. |
| D3 (was Q3) | Full loop everywhere (deploy, CI, max 3 iterations; up to 5 on the latest to reach green). | As planned. |
| D4 (was Q4) | Fix regressions that still reproduce at HEAD with a test; note published-only ones. | As planned. |
| D5 (was Q5) | Roles: admin, member and the template's seeded RBAC roles (`operator`, `org-admin`). | As planned. |
| D6 (was Q6) | Features: the fixed list (create, edit, complete, delete, due date, all/active/done filter; owner-scoped, synced). | As planned. |
| D7 (was Q7) | Mobile judged on mobile-width web (Playwright 390×844). | As planned. |
| D8 | Matrix = every stable 58.x release including patches, plus `local` (Q8 recommendation, assumed). | T8 `listVersions` keeps patches. |
| D9 | T10 drops the deploy and AI rows: R5, R13 and R2's deployed-login check are `SKIPPED (descoped, D9)`, with no Vercel, Atlas or Gemini credentials required. T10 and T11 still require R1-R4, R6-R12 and R9 to PASS. The answer to "Provide the four D1 credentials?" was "Drop the deploy/AI rows from the T10 criteria". | Narrows D1 and D3 for T10 only; R9 still needs `BOOTSTRAP_LOOP_GH_TOKEN` and `TerrenoLabs/bootstrap-todo-runs`. |

## Sign-off

Status: approved 2026-11-16
Cut: 2 rounds, 23 findings: 21 fixed, 2 moved to questions or expansions, 0 rebutted, 0 blocking open; no cut after sign-off: D2 only narrowed the version list
