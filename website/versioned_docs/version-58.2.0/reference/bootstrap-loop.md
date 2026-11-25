# Bootstrap loop

A repo-only harness (`scripts/bootstrapLoop/`) that builds the Terreno todo app from the naive
prompt "make me a todo app", scores the result in a separate session, and reruns failing stages
until the rubric passes. It catches regressions in the bootstrap template per version. It is not
shipped in any package.

Run it: [Run the bootstrap loop](../how-to/run-bootstrap-loop.md). The skill that drives the
builder is `bootstrap-todo-loop`.

## Stages

Eleven stages run in this order. `scaffold` is deterministic (it runs `create-terreno-app`); the
other ten are agent stages that drive the bootstrap skill with the stage's slice of the work.

| Order | Stage | Covers |
| --- | --- | --- |
| 1 | `scaffold` | Generate the app, pin Terreno versions, install, type-check the backend |
| 2 | `auth` | Better Auth, secure defaults |
| 3 | `admin` | Admin user and admin panel |
| 4 | `theming` | Theme and visual polish, desktop and mobile |
| 5 | `features` | Todo features (due dates, filter, edit) |
| 6 | `roles` | Member and admin roles |
| 7 | `consent` | Consent forms |
| 8 | `ai` | GPT and AI tooling (rulesync, `.mcp.json`) |
| 9 | `ci` | GitHub Actions and CircleCI with coverage |
| 10 | `deploy` | Deploy the app, seed an initial user |
| 11 | `checklist` | `CHECKLIST.md` for the user |

Each run of a stage writes `<runDir>/stages/<stage>.json`:

```json
{
  "stage": "auth", "version": "58.4.0", "status": "PASS", "attempt": 1,
  "startedAt": "...", "endedAt": "...", "minutes": 3.2,
  "checks": [{"name": "...", "status": "PASS", "ev": "..."}],
  "log": "tail of the builder output, secrets redacted"
}
```

A stage passes when every check in `checks` passes. `minutes` feeds the time score.

## Commands

`bun run bootstrap-loop <command>` (same as `bun scripts/bootstrapLoop/cli.ts`). Commands live in
`scripts/bootstrapLoop/commands/`.

| Command | Purpose |
| --- | --- |
| `stage <id> --version <v\|local> --run-dir <dir> [--failure <text>]` | Run one stage; `--failure` hands the builder a prior failure |
| `build --version <v\|local> --run-dir <dir> [--from <stage>] [--only a,b] [--keep-going]` | Run every stage in order |
| `score --run-dir <dir> [--previous <dir>]` | Score a build in a separate session; writes `score.json` and `SCORE.md` |
| `loop --version <v\|local> --run-dir <dir> [--max-iterations N] [--previous <dir>]` | Build, score, rerun failing stages; default 3 iterations; writes `ITERATIONS.md` |
| `matrix [--versions a,b] [--from-version <v>] [--no-local] [--work-dir <dir>] [--out <dir>] [--max-iterations N]` | Run the loop for every stable 58.x release plus `local`; writes `REGRESSIONS.md` |
| `upload --run-dir <dir> [--dest <dir>]` | Copy the app tarball, screenshots and redacted reports to the artifacts directory |
| `teardown --run-dir <dir>` | Delete the run's deploy, database and CI branch; refuses a run marked `keep: true` |

Exit codes: `0` success, `1` a stage, score or teardown failed, `2` bad usage.

## Rubric

The scorer returns PASS or FAIL for each row. All thirteen must pass. A row with missing
evidence fails. Deterministic probes collect the evidence; the scorer judges it.

| Row | Requirement |
| --- | --- |
| R1 | Admin user set up and the only kind of user who reaches `/admin/config` |
| R2 | Secure auth: Better Auth, no committed secrets, rate limit on, weak passwords refused |
| R3 | Theme applied and visual quality; the scorer gives `visualScore` 1 to 5, 4 or higher passes |
| R4 | Works on desktop and mobile |
| R5 | GPT setup works (`/gpt/prompt` streams, an `AIRequest` row is written) |
| R6 | Consent form exists and a fresh user is asked before the todo screen |
| R7 | New features present (create, edit, complete, delete, due date, filter) |
| R8 | Roles work; members stay out of admin routes and other users' todos |
| R9 | GitHub Actions and CircleCI both green, both with coverage |
| R10 | AI tooling wired (rulesync sources, generated agent docs, `.mcp.json` naming terreno-local) |
| R11 | `CHECKLIST.md` present for the user |
| R12 | Initial user seeded and able to log in |
| R13 | App deployed: URL serves 200, deep link survives refresh, login works |

The scorer also scores time: wall-clock minutes per stage and in total, compared with the
previous version's run. A stage or total that is more than 25% and more than 2 minutes slower than the previous version
is flagged as a time regression.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | all agent stages | Builder model access |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `ai` | Gemini key for the generated app's GPT routes |
| `CIRCLECI_TOKEN`, `BOOTSTRAP_LOOP_GH_TOKEN` | `ci`, scorer R9 | CI wiring and run status; the stage sees the GitHub token as `GH_TOKEN` |
| `VERCEL_TOKEN`, `BOOTSTRAP_LOOP_MONGO_URI` | `deploy` | Hosting and database for the deployed app |
| `BOOTSTRAP_LOOP_BUILDER_CMD` | builder | Override the builder command (default drives `claude -p`) |
| `BOOTSTRAP_LOOP_SCORER_CMD` | scorer | Override the scorer command (default read-only `claude -p`) |
| `BOOTSTRAP_LOOP_REPO`, `BOOTSTRAP_LOOP_CIRCLECI_SLUG` | scorer | Repository and CircleCI project to read run status from |
| `BOOTSTRAP_LOOP_SKIP_INSTALL` | `scaffold` | Skip `bun install` (tests only) |
| `BOOTSTRAP_LOOP_ARTIFACTS` | `upload` | Default destination root; default `/opt/cursor/artifacts/bootstrap-loop` |
| `BOOTSTRAP_LOOP_TEARDOWN_CMD` | `teardown` | Override the delete command (tests) |

Variables named `BOOTSTRAP_LOOP_FAKE_*` belong to the test fakes.

### Allowlists and redaction

A builder gets only the base shell variables, the model keys above, non-secret `BOOTSTRAP_LOOP_*`
settings, and the secrets its own stage needs: `ai` gets the Gemini key, `ci` gets the CI tokens,
`deploy` gets the Vercel token and Mongo URI. No other stage sees them. Stage logs and `upload`
replace every secret value found in the environment or the app's `.env` files with `[redacted]`.
The upload tarball excludes `node_modules`, `.env*`, `.vercel` and `.git`.

## Outputs

A run directory holds `app/`, `stages/*.json`, `build.json`, `evidence.json`, `score.json`,
`SCORE.md`, `ITERATIONS.md`, screenshots, and `deploy.json` (deploy id, database, branch, `keep`).
Committed runs live in `docs/bootstrapLoop/runs/<version>/`; the matrix report is
`docs/bootstrapLoop/REGRESSIONS.md`.

## Tests and CI

| Command | Runs | Where |
| --- | --- | --- |
| `bun run test:bootstrap-loop` | Unit tests with fakes, no network (`e2e/` excluded) | CircleCI `bootstrap-loop-ci` and `bootstrap-loop-ci.yml` when `scripts/bootstrapLoop/**` changes |
| `bun run test:bootstrap-loop:e2e` | Real `create-terreno-app` scaffold and stage run | `bootstrap-app-check.yml`: weekly, on tags, and on PRs touching `scripts/bootstrapLoop/e2e/**` or `stages/scaffold.ts` |
