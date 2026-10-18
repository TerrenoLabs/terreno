# Task List: Migrate CI/CD to CircleCI

See: [`docs/implementationPlans/migrate-cicd-to-circleci.md`](../implementationPlans/migrate-cicd-to-circleci.md)  
Research: [`docs/implementationPlans/migrate-cicd-to-circleci-research.md`](../implementationPlans/migrate-cicd-to-circleci-research.md)

## Instructions for the implementing agent

- Dual-run every phase: CircleCI green → flip required checks → delete GHA twin. Never enable tag publish on both systems.
- Do not store plaintext GCP JSON keys in CircleCI if OIDC is available; migrate `preview-cleanup` off `GCP_SA_KEY`.
- Pin orb versions (including `circleci/node` with Bun support ≥7.2.0).
- Prefer path parameters that mirror existing GHA path filters.
- Update docs in the same PR that changes the source of truth for how CI runs.
- After Phase 0, confirm CircleCI project follows the GitHub default branch `master`.

## Phase 0: Prerequisites

- [ ] **Task 0.1**: Confirm CircleCI org/plan and project link
  - Description: Verify the requester-created CircleCI organization, plan, and that `TerrenoLabs/terreno` is connected with permission to report GitHub checks. Enable **dynamic config** / setup workflows for the project. Record org slug + project slug in the IP header or how-to doc.
  - Files: `docs/how-to/circleci.md` (stub OK)
  - Depends on: none (human prerequisite)
  - Acceptance: a manual “hello” pipeline can be triggered from the project; dynamic config is enabled.
  - Note: hello scaffold merged (#1052). Dynamic config + org slug still need maintainer confirmation.

- [ ] **Task 0.2**: Create CircleCI Contexts (empty shells)
  - Description: Create contexts named in the IP (`terreno-npm`, `terreno-netlify`, `terreno-expo`, `terreno-gcp`, `terreno-e2e`, `terreno-release`, `terreno-agentic`, `terreno-github-api`). Document which GitHub secrets map into each. Do not paste secret values into the repo.
  - Files: `docs/how-to/circleci.md`
  - Depends on: Task 0.1
  - Acceptance: contexts exist; mapping table is complete; access restrictions noted for `terreno-release`.
  - Note: mapping table documented in how-to; contexts themselves are still a human step.

- [x] **Task 0.3**: Inventory required GitHub checks
  - Description: List current branch-protection required checks and map each to the GHA job `name:` and the future CircleCI job name. Start from `docs/explanation/repository-settings.md` and live settings.
  - Files: `docs/how-to/circleci.md` or a short table in the IP
  - Depends on: none
  - Acceptance: table covers policies, rulesync, package CI, fingerprint, and CD-related checks.

## Phase 1: Foundation

- [x] **Task 1.1**: Add setup + continue config skeleton
  - Description: Create `.circleci/config.yml` with `setup: true` using `circleci/path-filtering` (and `circleci/continuation`). Create `.circleci/continue-config.yml` with parameters for each package/area and a no-op `config-ok` job that always runs.
  - Files: `.circleci/config.yml`, `.circleci/continue-config.yml`
  - Depends on: Task 0.1
  - Acceptance: push triggers setup → continuation; `config-ok` is green.

- [x] **Task 1.2**: Shared Bun + cache commands
  - Description: Add reusable commands (inline or orb) for installing Bun via `circleci/node`, `bun install --frozen-lockfile`, and cache keys equivalent to today’s GHA bun cache. Pin Bun policy (`latest` vs pin) consistently with EAS jobs that need a pin.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 1.1
  - Acceptance: a sample job restores cache on second run; install is frozen-lockfile.

- [x] **Task 1.3**: Path-filter mapping
  - Description: Encode path → parameter mapping for api, ai, ui, rtk, comms, mcp-server, admin-*, example-*, demo, docs/website, terraform, e2e-relevant sets, matching current workflow path filters.
  - Files: `.circleci/config.yml`
  - Depends on: Task 1.1
  - Acceptance: a docs-only change sets docs/deploy params without setting `run-api`.
  - Note: deploy path params omitted until Phase 4+.

## Phase 2: Package CI + policy

- [x] **Task 2.1**: Port package CI jobs
  - Description: Port api/ai/rtk/ui/ui-demo/comms/mcp-server/example-frontend/example-backend(+script)/admin-spa CI to CircleCI jobs gated by path params. Include Mongo service where GHA used it. Fix mcp branch filter to `master`.
  - Files: `.circleci/continue-config.yml`, possibly package scripts unchanged
  - Depends on: Task 1.2, Task 1.3
  - Acceptance: dual-run green for each package on a change that touches it; GHA still required.

- [x] **Task 2.2**: Port Docker build-only job
  - Description: Port `example-backend-docker.yml` to CircleCI remote Docker / machine with layer caching replacement for `type=gha`.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 2.1
  - Acceptance: PR touching `example-backend/**` builds the image without pushing.

- [x] **Task 2.3**: Port repo-policies + rulesync + DCO
  - Description: Port `repo-policies.yml`, `rulesync-check.yml`, and fork DCO checks. DCO must use GitHub API via `terreno-github-api` context.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 0.2, Task 1.2
  - Acceptance: intentional barrel-import / dirty rulesync / missing DCO on a fork PR fails the CircleCI job.
  - Note: DCO skips cleanly if `GITHUB_TOKEN` unset until context is created.

- [ ] **Task 2.4**: Dual-run cutover for Phase 2
  - Description: Add CircleCI checks to branch protection; remove GHA package/policy workflows once trusted; delete corresponding `.github/workflows/*-ci.yml` and policy workflows.
  - Files: `.github/workflows/*`, `docs/explanation/repository-settings.md`
  - Depends on: Task 2.1, Task 2.2, Task 2.3
  - Acceptance: required checks are CircleCI-only for these surfaces; GHA files gone.

## Phase 3: Playwright E2E

- [x] **Task 3.1**: Port `e2e-ci` and `admin-spa-integration`
  - Description: Mongo replica set, E2E secrets context, Playwright browsers, artifact store for reports. Skip Dependabot-equivalent if applicable.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 2.1, Task 0.2
  - Acceptance: matrix (or equivalent) passes on master; artifacts downloadable.

- [ ] **Task 3.2**: Dual-run cutover for E2E
  - Description: Flip required checks if any; delete GHA e2e/admin-spa-integration workflows.
  - Files: `.github/workflows/e2e-ci.yml`, `admin-spa-integration.yml`, `admin-spa-ci.yml` as applicable
  - Depends on: Task 3.1
  - Acceptance: GHA twins deleted; CircleCI owns e2e.

## Phase 4: Netlify deploys

- [ ] **Task 4.1**: Port demo / frontend-example / docs Netlify workflows
  - Description: Build + `netlify-cli` deploy prod/preview; preserve alias naming (`pr-N`); recreate GitHub Deployment statuses via API if still desired.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 0.2, Task 1.3
  - Acceptance: preview deploy URL posted or visible; prod deploy on master path filter.

- [ ] **Task 4.2**: Preview cleanup port
  - Description: On PR close, clean Netlify/GCP preview resources from CircleCI (webhook or GitHub App → pipeline). Prefer OIDC over `GCP_SA_KEY`.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 4.1
  - Acceptance: closing a PR removes preview resources; no orphaned Cloud Run `pr-N` services in a test PR.

- [ ] **Task 4.3**: Dual-run cutover for Netlify
  - Description: Delete GHA deploy workflows after CircleCI trusted.
  - Files: `.github/workflows/demo-deploy.yml`, `frontend-example-deploy.yml`, `docs-deploy.yml`, `preview-cleanup.yml`
  - Depends on: Task 4.1, Task 4.2
  - Acceptance: GHA deploy twins deleted.

## Phase 5: EAS + fingerprint

- [ ] **Task 5.1**: Relocate CI scripts
  - Description: Move EAS/fingerprint shell scripts from `.github/workflows/scripts/` to `scripts/ci/` (or `.circleci/scripts/`) and update callers.
  - Files: `scripts/ci/*`, old script paths
  - Depends on: none
  - Acceptance: scripts runnable locally with documented env; no broken references.

- [ ] **Task 5.2**: Port eas-pr, eas-dev-build, fingerprint-gate
  - Description: CircleCI jobs using `EXPO_TOKEN`; PR comments and label gate via GitHub API; manual pipeline for eas-dev-build.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 5.1, Task 0.2
  - Acceptance: fingerprint change fails until `fingerprint-acknowledged`; EAS update/build path works on a test PR.

- [ ] **Task 5.3**: Dual-run cutover for EAS
  - Description: Delete GHA eas/fingerprint workflows after trust.
  - Files: `.github/workflows/eas-pr.yml`, `eas-dev-build.yml`, `fingerprint-gate.yml`
  - Depends on: Task 5.2
  - Acceptance: GHA twins deleted; CircleCI checks required where fingerprint was required.

## Phase 6: GCP CD + OIDC

- [ ] **Task 6.1**: Add CircleCI OIDC provider in terraform
  - Description: Extend or add module so GCP trusts CircleCI OIDC alongside GitHub during dual-run. Wire terreno terraform root; document outputs for CircleCI project settings.
  - Files: `terraform/modules/**`, terreno/Flourish terraform roots, `terraform/README.md`
  - Depends on: Task 0.1
  - Acceptance: `gcloud` auth from a CircleCI job succeeds with WIF (no JSON key).

- [ ] **Task 6.2**: Port `cd.yml`
  - Description: Path-filtered terraform fmt/preview/apply + Docker build/push + Cloud Run deploys + mcp-test/deploy. Preserve concurrency semantics (do not cancel in-flight prod applies).
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 6.1
  - Acceptance: terraform preview on PR; apply+deploy on master for a safe test path; GitHub Deployment records optional but documented.

- [ ] **Task 6.3**: Dual-run cutover for CD
  - Description: Single deployer: disable GHA `cd.yml` when CircleCI CD is required; remove GitHub OIDC provider only after GHA CD is gone (or keep read-only if other repos need it — document).
  - Files: `.github/workflows/cd.yml`, terraform OIDC
  - Depends on: Task 6.2
  - Acceptance: only CircleCI performs terreno CD; no double apply.

## Phase 7: npm publish

- [ ] **Task 7.1**: Port publish-on-tag + manual feature-flags publish
  - Description: Reproduce package publish graph, upgrade-docs gate, version bump, Zoom notify, demo dispatch, docs version cut. Use `terreno-release` + `terreno-npm` contexts.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 0.2, Task 2.1
  - Acceptance: dry-run or package-by-package rehearsal documented; Zoom path tested against a sandbox webhook if available.

- [ ] **Task 7.2**: Single-writer tag cutover
  - Description: In one coordinated change: enable CircleCI tag pipeline; delete/disable `.github/workflows/publish-on-tag.yml` and manual GHA publish; verify no double publish.
  - Files: `.github/workflows/publish-on-tag.yml`, `publish-feature-flags-manual.yml`
  - Depends on: Task 7.1
  - Acceptance: next tag publishes once from CircleCI only.

## Phase 8: Mobile (post-v1, required for CC1)

- [ ] **Task 8.1**: Port Maestro + Appium Android
  - Description: Port `maestro-e2e` and Android half of `demo-appium-ci` to CircleCI Linux VM with emulator strategy documented.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 5.2
  - Acceptance: manual pipeline runs Android Appium and Maestro successfully.

- [ ] **Task 8.2**: Port Appium iOS on CircleCI macOS
  - Description: Select macOS resource class/image with Working WDA; port iOS job; compare flake rate to GHA `macos-15`.
  - Files: `.circleci/continue-config.yml`
  - Depends on: Task 8.1
  - Acceptance: iOS Appium green on a representative run; then delete GHA Appium workflow.

## Phase 9: GitHub-native + agentic replacements

- [ ] **Task 9.1**: Replace CodeQL workflow
  - Description: Implement SARIF upload to GitHub Code Scanning from CircleCI or an approved SAST substitute; delete `codeql-analysis.yml` only when coverage is accepted.
  - Files: `.circleci/continue-config.yml`, `.github/workflows/codeql-analysis.yml`
  - Depends on: Task 0.2
  - Acceptance: Security tab still receives results **or** explicit maintainer sign-off on alternative.

- [ ] **Task 9.2**: Replace Dependabot auto-merge + triage + roadmap-generate + docs-audit
  - Description: Implement CircleCI (or Renovate) equivalents; wire issue/schedule triggers without leaving required logic on GHA.
  - Files: `.circleci/continue-config.yml`, corresponding GHA deletions
  - Depends on: Task 0.2
  - Acceptance: each former workflow’s acceptance behavior has an owner on CircleCI; GHA files deleted.

- [ ] **Task 9.3**: Replace architectural review + gh-aw agentics
  - Description: Per lockfile (`update-rules`, `update-docs`, daily improvers) and `architectural-pr-review` / `agentics-maintenance`: either port to CircleCI scheduled/PR pipelines with the same scripts or **retire** with maintainer sign-off. CC1 forbids leaving them on GHA.
  - Files: `.github/workflows/*lock*`, `architectural-pr-review.yml`, `agentics-maintenance.yml`, `.circleci/continue-config.yml`
  - Depends on: Task 0.2
  - Acceptance: written retire-or-port decision for each; no gh-aw workflows remain if ported/retired.

## Phase 10: Cleanup

- [ ] **Task 10.1**: Docs sweep
  - Description: Update CONTRIBUTING, repository-settings, terraform README, deploy guides, AGENTS/Cursor Cloud CI notes to CircleCI-first. Remove stale GHA instructions.
  - Files: `docs/**`, `CONTRIBUTING.md`, `AGENTS.md` / rules as needed
  - Depends on: Phases 2–7 at minimum; 8–9 for full CC1
  - Acceptance: `rg -n "GitHub Actions" docs/explanation/repository-settings.md` and deploy docs reflect CircleCI as source of truth.

- [ ] **Task 10.2**: Final GHA workflow purge + IP close
  - Description: Ensure `.github/workflows` has no CI/CD yml left (except intentionally empty dir or README). Set the IP `**Status:**` to Complete and archive the IP.
  - Files: `.github/workflows/`, `docs/implementationPlans/migrate-cicd-to-circleci.md`
  - Depends on: Task 9.3, Task 10.1, Task 8.2
  - Acceptance: `ls .github/workflows/*.yml` is empty (or only an agreed stub); IP status Complete.
