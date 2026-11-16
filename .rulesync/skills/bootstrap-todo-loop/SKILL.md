---
name: bootstrap-todo-loop
description: >-
  Build the Terreno todo app from the deliberately naive prompt "make me a todo
  app" by driving the bootstrap through eleven named stages, then score it with
  a separate session and rerun failing stages. Use to regression-test the
  bootstrap template for a version, run one stage in isolation, or run the full
  build, score and iterate loop. Repo-only harness; not for routine app work.
targets:
  - '*'
---
# Bootstrap todo loop

The prompt is exactly what a first-time user would type:

> make me a todo app

Use it verbatim. Add no requirements, framework hints, or design direction. The harness
supplies everything else through the bootstrap prompt and the stage prompts. This skill asks
no further questions: no human is present, so pick the sensible default and keep going.

Human docs: `docs/plans/2026-11-14-bootstrap-todo-loop.md`. The harness code is
`scripts/bootstrapLoop/`.

## Stages

Run in this order. Each is independently runnable and writes `<run-dir>/stages/<id>.json`.

| # | Stage | Prompt |
| --- | --- | --- |
| 1 | `scaffold` | the version's `terreno_bootstrap` prompt |
| 2 | `auth` | `references/stages/auth.md` |
| 3 | `admin` | `references/stages/admin.md` |
| 4 | `theming` | `references/stages/theming.md` |
| 5 | `features` | `references/stages/features.md` |
| 6 | `roles` | `references/stages/roles.md` |
| 7 | `consent` | `references/stages/consent.md` |
| 8 | `ai` | `references/stages/ai.md` |
| 9 | `ci` | `references/stages/ci.md` |
| 10 | `deploy` | `references/stages/deploy.md` |
| 11 | `checklist` | `references/stages/checklist.md` |

## Commands

1. Run one stage on an existing run dir:
   `bun run bootstrap-loop stage <id> --version <v|local> --run-dir <dir>`
2. Run the full build, score it, and rerun failing stages until the rubric passes:
   `bun run bootstrap-loop loop --version <v|local>`
3. Read the result in `<run-dir>/score.json` and `SCORE.md`. Pass means every row in
   `references/rubric.md` is PASS; UNKNOWN counts as a failure.

`<v>` is a published `create-terreno-app` version of 58.0.0 or later; `local` uses this checkout.

## Rules

- The builder and the scorer are separate sessions. Never score your own build.
- Never put credentials in a prompt or a committed file; the harness redacts logs and stage JSON.
- When a stage fails, fix it by rerunning that stage with its failures, not by hand-editing the app.
