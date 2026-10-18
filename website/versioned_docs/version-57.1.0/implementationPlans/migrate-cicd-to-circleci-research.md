# Research: Migrate CI/CD to CircleCI

**Status:** Research complete — decisions recorded in IP `migrate-cicd-to-circleci.md`  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1088
**Date:** 2026-08-17  
**Repo:** TerrenoLabs/terreno (`master` @ `1e3e79a6`)  
**Branch:** `cursor/migrate-cicd-circleci-2b6d`

## Scope statement

Investigate what “migrate all CI/CD to CircleCI” means for Terreno: inventory every GitHub Actions workflow, classify what is portable vs GitHub-native, map secrets/OIDC/deploy targets, and surface **candidate** CircleCI architectures with tradeoffs. No implementation decisions are committed here.

## Current state (findings)

### Scale

- **~36** hand-maintained `.github/workflows/*.yml` workflows
- **4** agentic `*.lock.yml` pipelines (gh-aw / Copilot), compiled from `.md` sources
- **No** `.circleci/` today
- **No** `.github/actions/` composites — Bun setup + cache is copy-pasted per workflow
- Helper scripts live under `.github/workflows/scripts/` (EAS/fingerprint) and `.github/scripts/`

### Category inventory

| Category | Examples | CircleCI portability |
|----------|----------|----------------------|
| Package CI | `api-ci`, `ui-ci`, `rtk-ci`, `ai-ci`, `comms-ci`, `mcp-server-ci`, example-* | High |
| Web E2E | `e2e-ci`, `admin-spa-ci`, `admin-spa-integration` (Playwright + Mongo) | High–medium |
| Mobile E2E | `demo-appium-ci` (Android + macos-15 iOS), `maestro-e2e` | Medium–low (macOS/Android emulator parity) |
| Expo/EAS | `eas-pr`, `eas-dev-build`, `fingerprint-gate` | Medium (CLI portable; PR labels/comments GitHub-centric) |
| Deploy GCP | `cd.yml`, `preview-cleanup` | Medium–hard (OIDC is GitHub-issuer only today) |
| Deploy Netlify | `demo-deploy`, `frontend-example-deploy`, `docs-deploy` | High–medium |
| Publish | `publish-on-tag`, `publish-feature-flags-manual` | Medium–hard (token push to master, Zoom, cross-workflow dispatch) |
| Policy | `repo-policies`, `rulesync-check`, `dco` | High (DCO is GitHub-PR metadata) |
| Security | `codeql-analysis` | Low (GitHub Code Scanning / Security tab) |
| GitHub-native | `dependabot-auto-merge`, `triage`, `roadmap-generate` | Low–none |
| Agentic | `architectural-pr-review`, `agentics-maintenance`, `*.lock.yml` | None (gh-aw, `pull_request_target`, Copilot) |

### Shared CI patterns

1. `oven-sh/setup-bun@v2` (`bun-version: latest`, sometimes pinned `1.3.10` for EAS)
2. `actions/cache` on `~/.bun/install/cache` keyed by OS + ref + lockfile
3. `bun install --frozen-lockfile` then package `lint` / `compile` / `test(:coverage|:ci)`
4. Mongo via `supercharge/mongodb-github-action` (image `mirror.gcr.io/library/mongo`) for api/ai/example-backend/e2e
5. Most package CI is **`on: push` with path filters**, not `pull_request` — checks appear when the PR head branch is pushed
6. Path filtering also uses `dorny/paths-filter` inside larger workflows (`cd.yml`, deploys)

### Deploy / release targets

| Target | Mechanism |
|--------|-----------|
| GCP `flourish-terreno` | Cloud Run (backend, tasks, mcp), Artifact Registry, Infra Manager terraform |
| Auth to GCP | Workload Identity Federation — issuer `https://token.actions.githubusercontent.com` (`terraform/modules/github_oidc`) |
| Preview cleanup | Still uses `GCP_SA_KEY` JSON (not WIF) |
| Netlify | demo, example-frontend, docs sites via `nwtgck/actions-netlify` |
| npm | Tag-driven publish of ~12 `@terreno/*` packages |
| EAS Cloud | PR updates/builds + manual workflow dispatch |
| GitHub Deployments API | CD + Netlify preview environments |

### Secrets / vars (union, migration-relevant)

**Secrets:** `NPM_TOKEN`, `EXPO_TOKEN`, `NETLIFY_*`, `GCP_SA_KEY`, `MCP_SENTRY_DSN`, `E2E_*`, `CURSOR_API_KEY`, `REPO_ADMIN_TOKEN`, `ROADMAP_PROJECT_TOKEN`, `ZOOM_WEBHOOK_*`, plus gh-aw Copilot tokens on lockfiles.

**Vars:** `GCP_WIF_PROVIDER_PROD`, `GCP_TF_ADMIN_SA_PROD`, `GCP_CD_DEPLOYER_SA_PROD`, `GCP_TF_PROJECT_ID_PROD`, `GCP_INFRA_MANAGER_LOCATION`, `ARCHITECTURAL_REVIEW_MODEL`, `TERRENO_PROJECT_NUMBER`.

### Branch protection (documented)

`docs/explanation/repository-settings.md`: require status checks including **Repository policies**, **package CI**, and **Rulesync Check** relevant to the change. Path-filtered checks are not always present — any CircleCI cutover must remap required checks carefully.

### External / CircleCI platform notes

- Official migration guide: map Actions → CircleCI jobs/workflows; Actions Marketplace ≈ Orb Registry ([CircleCI migrate from GitHub](https://circleci.com/docs/guides/migrate/migrating-from-github/)).
- Monorepo best practice: **dynamic config** (`setup: true`) + **path-filtering** orb so only affected packages run ([2026 monorepo guidance](https://www.devopsness.com/blog/circleci-best-practices-2026-07-19)).
- `circleci/node` orb **≥7.2.0** has first-class Bun (`install-bun`, frozen lockfile, cache) ([node-orb Bun support](https://github.com/oven-sh/bun/discussions/22830)).
- GCP OIDC from CircleCI is supported but requires a **new** Workload Identity provider (not a drop-in for the current GitHub-only module).

## Candidate options (not chosen)

### A. Full cutover (literal “all”)

Move every runnable pipeline to CircleCI; disable GHA workflows.

- **Pros:** Single CI vendor; one secrets home; one config language.
- **Cons:** Breaks CodeQL Security tab, Dependabot auto-merge, gh-aw agentic bots, issue triage, roadmap generate, `pull_request_target` review, GitHub Deployments UX unless reimplemented via API. Highest risk and cost.

### B. Hybrid “CI/CD on CircleCI, GitHub stays for GitHub-native”

Move package CI, E2E, Netlify, GCP CD, EAS triggers, publish to CircleCI. Keep CodeQL, Dependabot, DCO/triage/roadmap, and all gh-aw agentic workflows on GitHub Actions.

- **Pros:** Matches “migrate CI/CD” intent without destroying OSS/agentic GitHub integrations; clear ownership split.
- **Cons:** Two systems forever; dual required-check configuration; doc/contrib complexity.

### C. Phased hybrid with long dual-run

Same end-state as B, but phases: (1) mirror package CI, (2) Netlify, (3) EAS/fingerprint, (4) GCP OIDC + CD, (5) publish last. GHA remains required until each phase proves green.

- **Pros:** Lowest blast radius; easy rollback; validates CircleCI org/contexts/credits before cutting release path.
- **Cons:** Temporary double spend; longer calendar; discipline needed to delete GHA when done.

### D. CircleCI for compute-heavy only; keep CD/publish on GHA

Only migrate lint/test/Playwright/Appium; leave `cd.yml` + `publish-on-tag.yml` on Actions.

- **Pros:** Avoids OIDC rewrite and release double-publish risk; still reduces GHA minute pressure if that is the pain.
- **Cons:** Does not fulfill “all CI/CD”; two systems for the most critical paths.

## Recommended research framing (for questions, not a plan decision)

Option **C** is the lowest-risk path that still delivers a real CircleCI CD home; Option **A** is only viable if product/security accepts losing or re-homing GitHub-native surfaces. Option **D** is a scope cut, not a full migration.

## Open questions (fed into Step 3)

1. Literal “all” vs hybrid (what stays on GitHub)?
2. Dual-run duration and when GHA workflows are deleted?
3. CircleCI org/project already exist? Free vs Performance plan? Credit budget?
4. In-scope: GCP CD + npm publish in v1, or defer?
5. macOS Appium iOS — CircleCI macOS resource class vs keep on GHA?
6. Who owns secrets migration and branch-protection remapping?
7. Roadmap tracking issue after Approved?

## References

- Inventory of workflows: `.github/workflows/`
- GCP OIDC: `terraform/modules/github_oidc/`
- Deploy docs: `docs/explanation/deployment-architecture-gcp.md`, `terraform/README.md`
- Branch protection: `docs/explanation/repository-settings.md`
- CircleCI: [Migrating from GitHub](https://circleci.com/docs/guides/migrate/migrating-from-github/), node orb Bun support
