# GitHub Actions CI (Terreno)

CircleCI is the CI/CD of record; see [CircleCI](circleci.md). The GitHub
Actions CI and deploy workflows below are disabled
(`push.branches-ignore: ["**"]`) and kept only for rollback. This page
describes how they behaved if one is ever re-enabled.

## Docs site (`docs-deploy.yml`)

`Build docs site` is often the longest PR job because Docusaurus compiles every
versioned tree under `website/versioned_docs/` and TypeDoc regenerates API
pages.

PR builds set `DOCS_PREVIEW=true` and pass `--no-minify`. Both PR and
`master` use Docusaurus Faster (Rspack/SWC via `@docusaurus/faster`).

| Behavior | PR preview | `master` production |
| --- | --- | --- |
| Versioned docs (`57.1.0`, `0.30.0`, …) | Omitted (`disableVersioning`) | Built |
| JS minify | Off | On |
| Local search index | Skipped | Built |
| Generated API + component MDX | Restored from cache when `api`/`rtk`/`ui` hashes match | Same cache, then full generate on miss |
| TypeDoc workspace `tsc` | Once per generate (api+rtk deps share a process) | Same |
| Rspack cache (`node_modules/.cache/rspack`) | Restored per `pull_request` vs `push` | Separate production key |

Production still builds every version. Do not rely on `/57.1.0/…` URLs in a
PR deploy preview.

## Other high-cost jobs

| Workflow | What we skip or reuse |
| --- | --- |
| `e2e-ci`, `admin-spa-ci`, `admin-spa-integration` | Playwright Chromium under `~/.cache/ms-playwright`, keyed on `bun.lock`. E2E shards share one compile job (`workspace-dist` artifact) so required check names stay `E2E · <spec>`. |
| `fingerprint-gate` | Master iOS/Android hashes cached per `pull_request.base.sha` (skips a second `bun run compile`) |
| `maestro-e2e` | Demo export + static server only when `demo/`, `ui/`, or `.maestro/flows/demo/` change |
| `example-backend-docker` | Buildx runs only when the image recipe changes (`Dockerfile`, lockfile, `package.json`). Source-only PRs skip; CD preview deploy still builds the image. `load: true` stays off. |
| `cd` Cloud Run deploys | Runs a local wrapper around `google-github-actions/deploy-cloudrun` that retries only the transient GitHub WIF subject-token timeout, up to three attempts; IAM, image, and configuration failures fail immediately. The backend preview runs for every example-frontend PR preview, including frontend-only changes, so the Netlify build targets an isolated `pr-<number>` backend instead of production. The frontend deploy waits for that backend's healthy `/health` response before publishing to Netlify, and per-PR concurrency cancels duplicate deploys to the same alias. CD runs the built container against the configured Secret Manager values, including the Cloud Tasks `JOBS_*` env, and requires a healthy `/health` response before pushing or deploying. Preview Cloud Run uses `--memory=1Gi` and `--cpu-boost`, overwrites revision secrets, and binds `PORT` before MongoDB connect. Before deploy it rebuilds traffic with `--set-tags` / `--clear-tags` so a not-Ready tagged revision is omitted (`--remove-tags` leaves that revision in the spec and Cloud Run rejects the update). It then deploys `--no-traffic` without `--tag`, sets `--revision-suffix=pr<n>-<run_id>-<run_attempt>`, and tags the new Ready revision afterward. |
| Bun install | `.github/actions/setup-bun-workspace` pins Bun `1.4.0` and runs `bun install --frozen-lockfile` with no `~/.bun/install/cache`. CircleCI measurements: cache restore (~15–73s) exceeded the install savings (~9s). See [circleci.md](circleci.md#bun-install-is-uncached). |

Playwright e2e on CircleCI groups specs into five shards (`e2e-auth`,
`e2e-app`, `e2e-admin-core`, `e2e-admin-table`, `e2e-syncdb`). The retained GHA
twin still lists one spec per matrix entry for rollback.
