# Task List: OSS Governance Baseline

See: [`docs/implementationPlans/oss-governance-baseline.md`](../implementationPlans/oss-governance-baseline.md)

**RTK deprecation flag:** None. No task here touches `@terreno/rtk`, syncdb, or auth. Safe to implement before PR #869.

## Instructions for the implementing agent

- Do **not** change any source code under `*/src/`. This IP is documentation, metadata, and CI configuration only.
- Do **not** rewrite existing `README.md` prose. Only append the new governance section and badge.
- Answer keys used below follow the IP decisions recorded 2026-07-29 (**MIT**, DCO, Contributor Covenant 2.1, `security@terreno.app`, `conduct@terreno.app`, Conventional Commits CI-enforced). If the IP decision table changes, follow the IP.
- Run `bun run lint` before each commit. Run `bun run rules:check` if you touch anything under `.rulesync/`.
- One commit per task unless a task explicitly says otherwise.

## Phase 1: Legal baseline

- [x] **Task 1.1**: Add root `LICENSE` and `NOTICE`
  - Description: Copy the MIT License text to a new root `LICENSE` (use the standard MIT template; `mcp-server` already ships MIT). Create `NOTICE` containing the project name, the copyright line `Copyright 2026 Flourish Health, Inc.`, and a one-line statement that the project is licensed under MIT. Include acknowledgement of vendored `api/src/vendor/wesleytodd-openapi/` with a pointer to its own `LICENSE`.
  - Files: `LICENSE` (new), `NOTICE` (new)
  - Depends on: none
  - Acceptance: `LICENSE` exists at repo root with standard MIT text; `NOTICE` mentions the vendored openapi code. Do not compare against `api/LICENSE` or `ui/LICENSE` — those remain Apache-2.0 until Task 1.4.

- [x] **Task 1.2**: Audit license coverage across published packages
  - Description: Read `.github/workflows/publish-on-tag.yml` and list every package it publishes. For each one, record in a scratch table: whether a `LICENSE` file exists, whether `package.json` has a `files` array, whether `LICENSE` is included in that array, and the `license` field value. Write the findings as a markdown table in the PR description. Do not fix anything in this task.
  - Files: none (findings go in the PR body)
  - Depends on: none
  - Acceptance: PR body contains a table with one row per published package and the four columns above; the table is derived from the actual repo, not copied from the IP.

- [x] **Task 1.3**: Add `LICENSE` to every published package
  - Description: For each package identified in Task 1.2 that lacks a `LICENSE`, create one by copying the root `LICENSE`. Packages to cover: `rtk`, `ai`, `admin-backend`, `admin-frontend`, `admin-spa`, `api-health`, `feature-flags`, `mcp-server`, `test`. Do not create `LICENSE` files in non-published directories (`demo`, `example-frontend`, `example-backend`, `website`, `terraform`).
  - Files: `rtk/LICENSE`, `ai/LICENSE`, `admin-backend/LICENSE`, `admin-frontend/LICENSE`, `admin-spa/LICENSE`, `api-health/LICENSE`, `feature-flags/LICENSE`, `mcp-server/LICENSE`, `test/LICENSE` (all new)
  - Depends on: Task 1.1, Task 1.2
  - Acceptance: every published package directory contains a `LICENSE` identical to the root `LICENSE`.

- [x] **Task 1.4**: Align `license` fields and `files` arrays
  - Description: Set `"license": "MIT"` in the root `package.json` and in every published package's `package.json` (relicense `api`/`ui` from Apache-2.0). For every package that has an explicit `files` array, add `"LICENSE"` to it (`ui`, `rtk`, `admin-frontend`, `admin-spa`, `mcp-server` at minimum — confirm against Task 1.2 findings). Do not otherwise reorder or reformat `package.json`.
  - Files: `package.json`, `ui/package.json`, `rtk/package.json`, `admin-frontend/package.json`, `admin-spa/package.json`, `mcp-server/package.json`, plus any others found in Task 1.2
  - Depends on: Task 1.3
  - Acceptance: `bun pm pack --dry-run` run inside each published package lists `LICENSE` among the packed files; no `package.json` declares a license other than `MIT`.

- [x] **Task 1.5**: Verify relicensing consent for `api` and `ui`
  - Description: Run `git log --format='%an <%ae>' -- api/ ui/ | sort -u` and list every distinct author. Report the list in the PR body, flagging any address that is not a `@flourish.health` address or a known bot. Do **not** proceed to merge the Apache-2.0 → MIT change for `api`/`ui` if a non-Flourish human contributor appears; instead leave a `TODO` note in the PR body requesting sign-off. (`mcp-server` is already MIT.)
  - Files: none (findings go in the PR body)
  - Depends on: Task 1.4
  - Acceptance: PR body lists all `api`/`ui` authors and explicitly states either "all Flourish/bot — safe to relicense" or names the contributors needing sign-off.

- [x] **Task 1.6**: Add a license-coverage CI check
  - Description: Create `scripts/check-license-coverage.ts` (Bun, TypeScript, `const` arrow functions, explicit return types). It should: read the list of published packages from `.github/workflows/publish-on-tag.yml` (parse job names or a hardcoded list with a comment pointing at the workflow), then for each assert (a) `LICENSE` exists, (b) `package.json` `license` equals the root `package.json` `license`, (c) if a `files` array exists it contains `LICENSE`. Print one line per failure and `process.exit(1)` when any check fails. Add a `check:licenses` script to the root `package.json` and a job to `.github/workflows/repo-policies.yml` that runs it.
  - Files: `scripts/check-license-coverage.ts` (new), `package.json`, `.github/workflows/repo-policies.yml`
  - Depends on: Task 1.4
  - Acceptance: `bun run check:licenses` exits 0 on a clean tree; temporarily deleting `rtk/LICENSE` makes it exit 1 with a message naming `rtk`; the new CI job appears in `repo-policies.yml`.

## Phase 2: Contribution process

- [x] **Task 2.1**: Write `CONTRIBUTING.md`
  - Description: Create `CONTRIBUTING.md` covering, in this order: (1) Code of Conduct link; (2) ways to contribute (issue, discussion, docs fix, code); (3) development setup — `bun run bootstrap`, Bun version requirement, MongoDB replica-set requirement for `example-backend` (single-node replset is enough, change streams need it), the seeded users `test@example.com` / `superuser@example.com` with password `testpassword123`; (4) per-package commands table pulled from the root `package.json` scripts (`bun run api:test`, `bun run ui:test`, `bun run lint`, `bun run compile`); (5) code style pointers — link `AGENTS.md`, call out the no-barrel-imports rule and `bun run check:no-barrel-imports`, the Luxon requirement, and the logging conventions; (6) test expectations — new features ship with tests, coverage must not drop; (7) the IP process — link `docs/implementationPlans/README.md` and `IP_TEMPLATE.md`, explain when an IP is required (new package, new public API, cross-package change) versus not (bug fix, docs); (8) DCO sign-off instructions (`git commit -s`); (9) PR expectations — draft by default, CI green, screenshots for UI changes.
  - Files: `CONTRIBUTING.md` (new)
  - Depends on: none
  - Acceptance: every command shown in `CONTRIBUTING.md` exists in a `package.json` `scripts` block; the seeded credentials match `example-backend/src/scripts/`; no reference to `.claude/` or other agent-private paths.

- [x] **Task 2.2**: Add `CODE_OF_CONDUCT.md`
  - Description: Add Contributor Covenant 2.1 verbatim, with the enforcement contact set to `conduct@terreno.app`. Do not modify the covenant text other than the contact line and the project name.
  - Files: `CODE_OF_CONDUCT.md` (new)
  - Depends on: none
  - Acceptance: file states "Contributor Covenant" and version 2.1; contact address is present and is not a placeholder.

- [x] **Task 2.3**: Add `SECURITY.md`
  - Description: Create `SECURITY.md` with: a supported-versions table (current minor supported; previous minor receives security fixes only), reporting instructions naming GitHub private vulnerability reporting as the primary channel and `security@terreno.app` as fallback, a 5-business-day acknowledgement commitment, a statement that reporters should not open public issues for vulnerabilities, and a note that CodeQL runs on the repo (`.github/workflows/codeql-analysis.yml`).
  - Files: `SECURITY.md` (new)
  - Depends on: none
  - Acceptance: file exists at repo root so GitHub surfaces it under Security → Policy; both reporting channels are named.

- [x] **Task 2.4**: Add a DCO check for external PRs
  - Description: Add a workflow job (either in `repo-policies.yml` or a new `.github/workflows/dco.yml`) that, for pull requests whose head repository differs from the base repository, verifies every commit message contains a `Signed-off-by:` line matching the commit author. Skip the check for PRs from the same repo and for bot authors (`dependabot[bot]`, `cursor[bot]`). Follow the repo's existing convention of validating required inputs before use.
  - Files: `.github/workflows/dco.yml` (new) or `.github/workflows/repo-policies.yml`
  - Depends on: Task 2.1
  - Acceptance: the job's condition explicitly excludes same-repo PRs and the named bots; the workflow parses as valid YAML (`bunx yaml-lint` or equivalent).

## Phase 3: Changelog

- [x] **Task 3.1**: Create the root `CHANGELOG.md` and backfill releases
  - Description: Create `CHANGELOG.md` in Keep-a-Changelog format with an `## [Unreleased]` section at the top, then one section per released version, newest first. Source the content from `gh release list --limit 40` and `gh release view <tag>` for each release from 0.20.0 to the current version. Group each entry under `Added` / `Changed` / `Fixed` / `Deprecated` / `Removed`. Include a header note that all `@terreno/*` packages are versioned in lockstep and a link to `docs/implementationPlans/oss-launch-program.md` is **not** needed here. Do not invent entries — if a release has no notes, write `- No published release notes.` under that version.
  - Files: `CHANGELOG.md` (new)
  - Depends on: none
  - Acceptance: every version tag returned by `gh release list` between 0.20.0 and current has a section; no section is empty; the file states the lockstep versioning rule.

- [x] **Task 3.2**: Reduce `api/CHANGELOG.md` to a pointer
  - Description: Replace the contents of `api/CHANGELOG.md` with a short note that the changelog moved to the repo root, linking `../CHANGELOG.md`. Preserve the historical entries by moving them into the corresponding root `CHANGELOG.md` sections first if they contain detail the GitHub releases lack.
  - Files: `api/CHANGELOG.md`, `CHANGELOG.md`
  - Depends on: Task 3.1
  - Acceptance: `api/CHANGELOG.md` is under 10 lines and links to the root changelog; no historical detail was lost.

- [x] **Task 3.3**: Make changelog updates part of the release process
  - Description: Edit `.rulesync/skills/release/SKILL.md` to add a required step: before tagging, move `## [Unreleased]` content into a new version section in the root `CHANGELOG.md` with today's date (via Luxon-formatted ISO date), and confirm the section is non-empty. Then run `bun run rules` to regenerate the mirrored skill files under `.cursor/`, `.claude/`, `.devin/`, `.github/`, and `.agents/`.
  - Files: `.rulesync/skills/release/SKILL.md`, plus generated mirrors
  - Depends on: Task 3.1
  - Acceptance: `bun run rules:check` exits 0 (no uncommitted diff after regeneration); the release skill mentions `CHANGELOG.md` as a required pre-tag step.

## Phase 4: GitHub templates

- [x] **Task 4.1**: Add issue forms
  - Description: Create three GitHub issue forms. `bug_report.yml`: fields for affected package (dropdown listing all published `@terreno/*` packages plus `docs`, `examples`, `mcp`), version, platform (dropdown: iOS / Android / Web / Backend / N/A), reproduction steps (required textarea), expected vs actual, and a checkbox confirming the reporter searched existing issues. `feature_request.yml`: problem statement (required), proposed solution, alternatives considered, and a checkbox asking whether the requester is willing to open a PR. `docs_issue.yml`: page URL, what is wrong or missing, and suggested fix. Add `config.yml` with `blank_issues_enabled: false` and contact links to Discussions (Q&A and Ideas categories) and `SECURITY.md`.
  - Files: `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/docs_issue.yml`, `.github/ISSUE_TEMPLATE/config.yml` (all new)
  - Depends on: Task 2.3
  - Acceptance: all four files parse as valid YAML; the package dropdown in `bug_report.yml` matches the packages published by `publish-on-tag.yml`; `config.yml` disables blank issues.

- [x] **Task 4.2**: Add a PR template
  - Description: Create `.github/PULL_REQUEST_TEMPLATE.md` with sections: Summary; Related IP or issue; Type of change (checkboxes); Testing performed (with a reminder that frontend changes require screenshots or video per `AGENTS.md`); Checklist (tests added, `bun run lint` passes, `bun run compile` passes, docs updated, changelog `Unreleased` entry added for user-facing changes, DCO signed off). Keep it short enough that contributors actually fill it in — under 40 lines.
  - Files: `.github/PULL_REQUEST_TEMPLATE.md` (new)
  - Depends on: Task 2.1, Task 3.1
  - Acceptance: template is under 40 lines; references the changelog and the frontend-verification requirement.

- [x] **Task 4.3**: Add `CODEOWNERS`
  - Description: Create `.github/CODEOWNERS` mapping each package directory to its owning team or maintainer, plus a catch-all root owner. Use GitHub team handles if they exist; otherwise use individual maintainer usernames. Include entries for `docs/`, `.github/`, `.rulesync/`, and `terraform/`.
  - Files: `.github/CODEOWNERS` (new)
  - Depends on: none
  - Acceptance: every top-level package directory has an owner; the file has a catch-all `*` line; GitHub's CODEOWNERS validation (visible in repo settings) reports no errors.

- [x] **Task 4.4**: Document required repository settings
  - Description: Add a short section to `CONTRIBUTING.md` (or a new `docs/explanation/repository-settings.md` if it exceeds 30 lines) listing the GitHub settings a maintainer must enable manually because they cannot be committed: Discussions enabled with the categories from [`public-roadmap-github.md`](../implementationPlans/public-roadmap-github.md), private vulnerability reporting enabled, branch protection on `master` requiring the CI checks, "Allow squash merging" only, and auto-delete of merged branches.
  - Files: `CONTRIBUTING.md` or `docs/explanation/repository-settings.md`
  - Depends on: Task 2.1
  - Acceptance: the list names each setting and where to find it in the GitHub UI; no setting is described as already enabled unless verified.

- [x] **Task 4.5**: Append the governance section to `README.md`
  - Description: Add a `## License` section and a `## Contributing` section near the end of `README.md`, plus a license badge next to the existing npm badges. Link `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`. Do not modify any other README content — positioning changes belong to a different IP.
  - Files: `README.md`
  - Depends on: Task 1.1, Task 2.1, Task 2.2, Task 2.3
  - Acceptance: `git diff README.md` shows only additions (badge line plus two new sections); all four links resolve to files that exist.
