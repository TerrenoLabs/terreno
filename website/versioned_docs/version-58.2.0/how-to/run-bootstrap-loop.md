# Run the bootstrap loop

Build the todo app from "make me a todo app", score it, and rerun failing stages. Reference for
stages, rubric and variables: [Bootstrap loop](../reference/bootstrap-loop.md).

Run every command from the repo root. Use a fresh `--run-dir` per run.

## Before you start

Export the credentials the stages you run need (see the reference for which stage uses which):
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, plus `GOOGLE_GENERATIVE_AI_API_KEY`,
`CIRCLECI_TOKEN`, `BOOTSTRAP_LOOP_GH_TOKEN`, `VERCEL_TOKEN` and `BOOTSTRAP_LOOP_MONGO_URI` for the
`ai`, `ci` and `deploy` stages. Run `bun install` once.

## Run one stage

1. Scaffold a base app: `bun run bootstrap-loop stage scaffold --version local --run-dir /tmp/run1`
2. Run the stage on it: `bun run bootstrap-loop stage auth --version local --run-dir /tmp/run1`
3. Read `/tmp/run1/stages/auth.json`. To retry with a known failure, add `--failure "<what failed>"`.

`--version local` uses the checkout; a published version such as `58.4.0` pins the packages.

## Run the full build

`bun run bootstrap-loop build --version local --run-dir /tmp/run2`

Resume with `--from <stage>`, run a subset with `--only auth,roles`, or continue past a failing
stage with `--keep-going`.

## Run the loop

`bun run bootstrap-loop loop --version local --run-dir /tmp/run3 --max-iterations 3`

The loop builds, scores in a separate session, and reruns the failing stages until all rubric rows
pass or the iterations run out. Each iteration is logged to `ITERATIONS.md` (what failed, what
changed, new score). Pass `--previous <dir>` to compare times with an earlier run.

To score alone: `bun run bootstrap-loop score --run-dir /tmp/run3`

## Run the version matrix

`bun run bootstrap-loop matrix --out docs/bootstrapLoop`

This runs the loop for every stable 58.x release and `local`, then writes the version-by-version
`REGRESSIONS.md`. Narrow it with `--versions 58.3.0,58.4.0` or `--from-version 58.2.0`, or leave
out the checkout with `--no-local`.

## Upload and tear down

1. Upload: `bun run bootstrap-loop upload --run-dir /tmp/run3` copies the app tarball, screenshots
   and redacted reports to `/opt/cursor/artifacts/bootstrap-loop/run3`. Pass `--dest <dir>` to change it.
2. Tear down: `bun run bootstrap-loop teardown --run-dir /tmp/run3` deletes the deploy, database and
   CI branch. It exits `2` for a run whose `deploy.json` has `keep: true`.

## Run the harness tests

- `bun run test:bootstrap-loop`: unit tests, no network.
- `bun run test:bootstrap-loop:e2e`: scaffolds a real app; takes several minutes.
