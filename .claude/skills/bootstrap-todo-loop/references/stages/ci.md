# Stage: ci — GitHub Actions and CircleCI

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: `docs/how-to/github-actions-ci.md`, `docs/how-to/circleci.md`

## Do

1. Add `.github/workflows/ci.yml` and `.circleci/config.yml` that each install, lint, type-check and run the backend and frontend tests with coverage, and print or upload a coverage report.
2. Validate every required secret at the top of each GitHub job (fail fast with the missing names).
3. Create or reuse the run repository named by `BOOTSTRAP_LOOP_GH_REPO`, push the build branch, and wait until both hosts report success. Fix failures and push again until green.

## Done when

Both config files exist, and the latest run of the build branch is green on both hosts.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
