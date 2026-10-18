# Implementation Plan: Examples, Demo, and Test Coverage

**Status:** Draft — key decisions recorded (2026-07-29)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1016
**Priority:** Medium
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** [`docs-reference-coverage`](docs-reference-coverage.md) (demo README)
**RTK deprecation flag:** **Partial** — example-app tasks touch the data layer and are `[RTK]` marked. The demo app is `@terreno/ui`-only and has no data layer, so its tasks are safe now.

## Goal

Close the credibility gaps a prospective adopter checks before trusting a framework: does the component library have visible examples, are the claimed features actually exercised, and does CI enforce the quality bar the project claims.

Three concrete problems today:

1. **The demo app covers roughly 58 of the library's components.** Notable omissions include `GPTChat`, `ActionSheet`, `SplitPage`, `SocialLoginButton`, `DraggableList`, `FilePickerButton`, `Image`, `ModalSheet`, and `UpgradeRequiredScreen`. A component with no visible example is a component people assume is broken. `demo/package.json`'s `test:ci` is `echo 'No tests'`.
2. **Coverage gates are enforced unevenly.** `api`, `rtk`, and `mcp-server` CI enforce the 95% threshold via `scripts/check-coverage.ts`. `ui`, `ai`, `admin-backend`, `admin-frontend`, `admin-spa`, `feature-flags`, and `api-health` have `test:coverage` scripts but no CI job enforcing them. Three published packages have no dedicated CI workflow at all.
3. **No public coverage signal.** No badge, no Codecov, so the claim "well tested" is unverifiable from outside.

## Non-Goals

- Raising coverage thresholds.
- Writing tests for every uncovered line (the daily test-improver workflow already chips at this).
- Building a fourth example app.
- Visual regression testing.

## Blocking questions

**Recorded 2026-07-29** (defaults accepted).

| # | Question | Decision |
|---|----------|----------|
| E1 | Demo story for every UI component? | **B** — CI-enforced exports + allowlist |
| E2 | Codecov / badge | **A** |
| E3 | Dedicated CI per package | **B** — matrix workflow |
| E4 | Enforce coverage below threshold? | **A** — enforce immediately; failing packages catch up first |
| E5 | Example feature-parity checklist | **A** |

## Architecture

### Demo story coverage

`demo/` is an Expo Router app where each component demo is a story in `demo/stories/*.stories.tsx` registered in `demoConfig.tsx`. Adding coverage means adding stories and registering them.

The enforcement mechanism: a script that reads the export list from `ui/src/index.tsx`, reads the registered stories from `demoConfig.tsx`, and fails when an exported component has neither a story nor an allowlist entry. Run in `ui-demo-ci.yml`.

Priority for the missing stories — highest-visibility first:

| Priority | Components | Why |
|----------|-----------|-----|
| P0 | `GPTChat`, `SocialLoginButton`, `SplitPage` | Directly demonstrate the AI and auth pillars and the responsive web layout |
| P1 | `ActionSheet`, `ModalSheet`, `FilePickerButton`, `Image` | Common in real apps |
| P2 | `DraggableList`, `UpgradeRequiredScreen`, remaining gaps | Less common |

Derive the actual missing list from the export list at implementation time rather than trusting this table.

### Coverage enforcement

```mermaid
flowchart LR
  S["scripts/check-coverage.ts<br/>(exists)"]
  T["95% threshold<br/>(per bunfig.toml)"]
  M["ci: matrix job for packages<br/>without dedicated workflows"]
  E["existing package CI<br/>api, rtk, mcp, ui, ai, admin-spa"]
  C["Codecov upload<br/>+ per-PR delta"]
  S --> T
  T --> M
  T --> E
  M --> C
  E --> C
```

Per decision E4, enforce the existing 95% threshold immediately on every published package. Packages currently below threshold must catch up before the gate passes CI — no ratchet floors file. The daily test-improver workflow continues to raise coverage over time.

### Example app feature matrix

The repo states that `example-frontend` and `example-backend` serve as documentation and integration tests. That is only true if it is checked. A matrix in `docs/explanation/example-coverage.md` maps each framework capability to whether an example exercises it:

| Capability | example-backend | example-frontend | Gap |
|------------|-----------------|------------------|-----|
| `modelRouter` CRUD | yes | yes | — |
| Owner permissions | yes | yes | — |
| Admin panel (embedded) | yes | yes | — |
| Admin SPA | yes | n/a | — |
| AI streaming chat | yes | yes | — |
| AI structured output | ? | ? | verify |
| Feature flags + live updates | yes | yes | — |
| Websockets / realtime | yes | yes | — |
| Consent forms | yes | yes | — |
| File upload / GCS | yes | yes | — |
| Better Auth | ? | ? | verify |
| syncdb local-first | (from #869) | (from #869) | verify after merge |
| RBAC | no | no | not shipped |
| Background jobs | no | no | not shipped |

Every `?` must be resolved by reading the example source, and every real gap either filled or recorded as a known gap.

## Models / APIs / Notifications

None.

## UI

New demo stories only. No changes to `@terreno/ui` components except bug fixes discovered while writing stories — which is a common and welcome side effect.

## Phases

1. **Demo coverage** — audit, P0 stories, then the enforcement check.
2. **Remaining demo stories** — P1 and P2.
3. **Coverage enforcement** — wire the 95% threshold into every package CI (matrix job for packages without dedicated workflows).
4. **Codecov** — upload and badges.
5. **Example feature matrix** — audit and fill or record gaps.

## Feature Flags & Migrations

None. Enforcing the threshold immediately may require a short catch-up period for packages currently below 95%; track that work in the implementation PR rather than lowering the bar.

## Not Included / Future Work

- Visual regression / screenshot testing of the demo.
- Raising coverage thresholds beyond current levels.
- Publishing the demo app to app stores.
- Consolidating the Appium and Maestro E2E suites.

## Files to Create / Modify

**Create**

- `demo/stories/*.stories.tsx` (the missing components)
- `scripts/check-demo-coverage.ts`
- `.github/workflows/packages-ci.yml` (matrix for packages without dedicated CI)
- `docs/explanation/example-coverage.md`
- `codecov.yml`

**Modify**

- `demo/demoConfig.tsx`
- `demo/package.json` (`test:ci` currently a no-op)
- `.github/workflows/ui-demo-ci.yml`, `ui-ci.yml`, `ai-ci.yml`, `admin-spa-ci.yml`
- `README.md` (coverage badge)
- `CONTRIBUTING.md` (coverage expectations)

## Task List

See [`docs/tasks/examples-demo-coverage.md`](../tasks/examples-demo-coverage.md).

## Acceptance Criteria

- [ ] Every component exported from `ui/src/index.tsx` has a demo story or an allowlist entry with a stated reason.
- [ ] `bun run scripts/check-demo-coverage.ts` fails when a newly exported component has no story and no allowlist entry, and runs in `ui-demo-ci.yml`.
- [ ] `demo/package.json`'s `test:ci` runs something real.
- [ ] Stories exist for all P0 components, each showing multiple states (default, loading, error, disabled) where applicable.
- [ ] Every published package's CI runs `scripts/check-coverage.ts` at the 95% threshold.
- [ ] Packages currently below 95% have a tracked catch-up plan; no package is permanently exempt.
- [ ] Every published package is covered by CI running its tests and coverage check, either through a dedicated workflow or the matrix job.
- [ ] Codecov receives uploads from every package's CI and reports per-PR deltas.
- [ ] `README.md` shows a coverage badge that reflects reality.
- [ ] `docs/explanation/example-coverage.md` resolves every `?` in the capability matrix, and each real gap is either filled with an example or recorded as a known gap with an issue link.
- [ ] `CONTRIBUTING.md` states the 95% coverage expectation and how to run coverage locally per package.
- [ ] `bun run lint`, `bun run compile`, and the full test suite pass.
