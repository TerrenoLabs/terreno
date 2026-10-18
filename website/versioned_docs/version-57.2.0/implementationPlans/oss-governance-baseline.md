# Implementation Plan: OSS Governance Baseline

**Status:** Approved — decisions recorded (2026-07-29)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1003
**Priority:** High
**Effort:** Small batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** none
**RTK deprecation flag:** None — no framework surface touched. Safe to implement before PR #869.

## Goal

Make the repository legally and procedurally publishable: a license every consumer can rely on, a documented contribution path, a security disclosure process, a living changelog, and GitHub's community-health files. Today the repo has two stray `LICENSE` files (`api/`, `ui/`), one stale `CHANGELOG.md` (`api/`, last entry 0.20.0 against a current 0.26.0), no root license, and no contributing/security/conduct documents.

This is the hard blocker: without it, nothing else in the program can ship publicly.

## Non-Goals

- Rewriting the README's content or positioning — that is [`positioning-django-rails-universal`](positioning-django-rails-universal.md). This IP only *adds* the License / Contributing / Security / Code of Conduct links.
- Auditing dependency licenses for compatibility.
- Setting up sponsorship, OpenCollective, or a CLA bot.
- Changing CI beyond adding license/community-file checks.

## Blocking questions

**Recorded 2026-07-29** (see program [P1–P2](oss-launch-program.md#blocking-questions-program-level)).

| # | Question | Decision |
|---|----------|----------|
| G1 | License (→ P1) | **MIT everywhere** — root `LICENSE`, per-package `LICENSE` files, and all `package.json` `license` fields |
| G2 | Copyright line | **`Copyright 2026 Flourish Health, Inc.`** in `LICENSE`; `NOTICE` credits contributors |
| G3 | Contributor provenance (→ P2) | **DCO** — `Signed-off-by` enforced by CI on external PRs |
| G4 | Security contact | **`security@terreno.app`** + GitHub private vulnerability reporting (PVR as primary) |
| G5 | Changelog strategy | **Root `CHANGELOG.md`** in Keep-a-Changelog format; `api/CHANGELOG.md` becomes a pointer |
| G6 | Enforce Conventional Commits? | **Yes, CI-enforced** on new PRs |
| G7 | Code of Conduct | **Contributor Covenant 2.1** with **`conduct@terreno.app`** |

## Architecture

No code architecture. Three groups of artifacts:

1. **Legal** — root `LICENSE`, `NOTICE`, per-package `LICENSE` files, `license` fields in every `package.json`, `files` arrays updated so the license ships in every npm tarball.
2. **Process** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`.
3. **Enforcement** — a `repo-policies.yml` job (the workflow already exists) that fails when a published package lacks a `LICENSE` in its `files` array or its `license` field disagrees with the root license.

### Published packages requiring license coverage

From `publish-on-tag.yml`, eleven packages publish in lockstep. Current state:

| Package | `LICENSE` file | In `files` array | `license` field |
|---------|----------------|------------------|-----------------|
| `api` | yes | implicit (no `files`) | Apache-2.0 → **MIT** |
| `ui` | yes | **missing from `files`** | Apache-2.0 → **MIT** |
| `rtk` | **no** | **missing from `files`** | Apache-2.0 → **MIT** |
| `ai` | **no** | implicit | Apache-2.0 → **MIT** |
| `admin-backend` | **no** | implicit | Apache-2.0 → **MIT** |
| `admin-frontend` | **no** | **missing from `files`** | Apache-2.0 → **MIT** |
| `admin-spa` | **no** | **missing from `files`** | Apache-2.0 → **MIT** |
| `api-health` | **no** | implicit | Apache-2.0 → **MIT** |
| `feature-flags` | **no** | implicit | Apache-2.0 → **MIT** |
| `mcp-server` | **no** | **missing from `files`** | MIT (already) |
| `test` | **no** | implicit | Apache-2.0 → **MIT** |

Task 1.2 must re-derive this table from the repo at implementation time rather than trusting it.

## Models

None.

## APIs

None.

## Notifications

None.

## UI

None.

## Phases

1. **Legal baseline** — root license, per-package licenses, `package.json` alignment, CI guard.
2. **Contribution process** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, DCO check.
3. **Changelog** — root `CHANGELOG.md`, backfill 0.20.0–0.26.0 from GitHub releases, wire into the `release` skill.
4. **GitHub templates** — issue forms, PR template, `CODEOWNERS`, repo settings checklist.

## Feature Flags & Migrations

None. Relicensing `api` and `ui` from Apache-2.0 to MIT is a one-way change; it requires sign-off from every contributor to those packages who is not a Flourish employee (verify with `git log --format='%an %ae' -- api/ ui/`). `mcp-server` is already MIT.

## Activity Log & User Updates

None.

## Not Included / Future Work

- Dependency license compatibility audit (`bunx license-checker`-style report).
- `FUNDING.yml` / sponsorship.
- Automated changelog generation from Conventional Commits.
- Trademark policy for the Terreno name.

## Files to Create / Modify

**Create**

- `LICENSE`
- `NOTICE`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `rtk/LICENSE`, `ai/LICENSE`, `admin-backend/LICENSE`, `admin-frontend/LICENSE`, `admin-spa/LICENSE`, `api-health/LICENSE`, `feature-flags/LICENSE`, `mcp-server/LICENSE`, `test/LICENSE`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/docs_issue.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- `scripts/check-license-coverage.ts`

**Modify**

- `package.json` (root: add `license`)
- `ui/package.json`, `rtk/package.json`, `admin-frontend/package.json`, `admin-spa/package.json`, `mcp-server/package.json` (`files` + `license`)
- `api/CHANGELOG.md` (reduce to a pointer at the root changelog)
- `README.md` (append License / Contributing / Security / Code of Conduct section and badge — content-neutral)
- `.github/workflows/repo-policies.yml` (add license-coverage job)
- `.rulesync/skills/release/SKILL.md` (require a root `CHANGELOG.md` entry per release)

## Task List

See [`docs/tasks/oss-governance-baseline.md`](../tasks/oss-governance-baseline.md).

## Acceptance Criteria

- [ ] `LICENSE` exists at the repo root and matches the decision from G1.
- [ ] Every package in `publish-on-tag.yml` has a `LICENSE` file, a matching `license` field, and ships the license in its npm tarball (verified via `bun pm pack --dry-run` per package).
- [ ] `bun run scripts/check-license-coverage.ts` exits 0 and fails when a `LICENSE` is deleted from any published package.
- [ ] `CONTRIBUTING.md` documents: `bun run bootstrap`, how to run tests/lint per package, the no-barrel-imports rule, the IP process, DCO sign-off, and how to propose a change.
- [ ] `SECURITY.md` lists supported versions and both reporting channels; GitHub private vulnerability reporting is enabled in repo settings.
- [ ] `CODE_OF_CONDUCT.md` is Contributor Covenant 2.1 with a working report address.
- [ ] `CHANGELOG.md` has entries for 0.20.0 through the current release, newest first, in Keep-a-Changelog format.
- [ ] Opening a new issue in the GitHub UI offers Bug / Feature / Docs forms plus a link to Discussions.
- [ ] `README.md` links License, Contributing, Security, and Code of Conduct above the fold or in a clearly labeled section.
- [ ] `bun run lint` and `bun run rules:check` pass.
