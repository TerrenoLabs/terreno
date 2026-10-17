---
name: update-dependencies
description: 'Upgrade dependencies and prove them: bump JavaScript and GitHub Actions versions on one rolling PR, exercise each bump with a test that imports it, verify the batch locally before a single push, refuse Expo fingerprint changes, and keep a ledger of what landed and failed. This is the only path for routine version upgrades — Dependabot opens security PRs only. Trigger with /update-dependencies or "update/upgrade/bump dependencies", "outdated packages", "daily dependency updates", or a Dependabot security PR that needs code changes.'
---
# Update dependencies

Routine JavaScript and GitHub Actions upgrades. Dependabot opens **security
PRs only**; every other version bump goes through this skill on **one**
rolling PR. Prove each bump with a test that imports the package, verify the
whole batch locally, then push **once**. Native Expo fingerprint changes are
**release-only**.

Architecture: [`docs/explanation/dependency-management.md`](../../docs/explanation/dependency-management.md).
Operator steps: [`docs/how-to/update-dependencies.md`](../../docs/how-to/update-dependencies.md).
Fingerprint skip matcher: `scripts/planning/fingerprintRisk.ts`.
Rolling PR + ledger: [`references/rolling-pr.md`](references/rolling-pr.md) (`scripts/planning/updateDependenciesPr.ts`).
Native SDK upgrades: `upgrading-expo` and `release`, never this skill.

## Hard rules

1. **Fingerprint freeze.** Do not bump a package when `isFingerprintSkip(name)` is true. Do not edit `eas.json`, Expo config plugins, `app.json` native fields, or native project files. After every allowed bump, recompute fingerprints for `example-frontend` and `demo`; if either hash changes, revert **that bump** and log it as failed.
2. **Exercise test.** Keep a bump only when a test that imports the bumped package ran and passed **after** the bump. Workspace `test:ci` alone is not proof. No such test → write a tracer-bullet test first.
3. **Local green before push.** Run the batch gate in step 5 and fix or revert until it is green. CI confirms local results; it is not the test runner.
4. **One batch push per run.** Batch all commits, push once. After that, push only to fix red CI on that head (rule 6). Never push a speculative CI fix to see whether it works.
5. **Hands off CI config.** Never edit `.circleci/`, `.github/workflows/`, executors, resource classes, or heap flags to make a bump pass. A CI-config problem means stop and escalate (rule 6).
6. **Never leave the rolling PR red.** Follow push ownership (`plugins/terreno-planning/references/push-ownership.md`): fix red CI and answer every review-bot comment, for at most three fix rounds. Still red after the third → stop pushing and escalate: the final message starts with `BLOCKED — PR #<n> still red after 3 fix rounds`, and the PR body's Last run names the failing jobs.
7. **One trusted rolling PR.** Push only to the same-repository `chore/update-dependencies` head; `isTrustedRollingPr` must pass. Never push to `dependabot/*` branches or to a fork. Ledger and trust rules: [`references/rolling-pr.md`](references/rolling-pr.md).
8. **7-day cooldown** for non-security npm publishes. Security advisories skip the wait; they still need an exercise test and a fingerprint freeze.
9. **Catalog once.** Shared versions change only in the root `package.json` `catalog`. Workspace manifests keep `"catalog:"`. See `.rulesync/rules/01-dependency-catalog.md`.

## When to use

- The scheduled maintenance agent or a human asks to bump, update, or refresh packages
- A Dependabot **security** PR fails CI because the fix needs code changes — fold that bump into the rolling PR and leave the Dependabot PR alone (close it only when a human says so)

## When not to use

- A Dependabot security PR that is green — it merges on its own; do not push to it
- Expo SDK, React Native, or native-module upgrades — `upgrading-expo` during a `release`
- Adding a new dependency for a feature — that feature's Pick slice owns it
- `@terreno/*` lockstep upgrades — `upgrading-terreno`

## Procedure

### 1. Attach the rolling PR

Follow [`references/rolling-pr.md`](references/rolling-pr.md): find the trusted PR, merge `origin/master` into `chore/update-dependencies` without rewriting history, and restore the ledger from its body. Count the CI rounds already logged for this run.

Completion: at most one trusted open PR identified (or none yet); forks and spoofs ignored; branch contains current master; the previous Landed/Failed/Skipped tables are in hand.

### 2. Inventory

Record a fingerprint **baseline** before any new install (commands in [`references/fingerprint-risk.md`](references/fingerprint-risk.md)), then:

```bash
bun outdated
```

Cooldown: `npm view <name> time --json` → `time[<version>]` must be at least 7 days old unless the bump fixes a published advisory. Move every `isFingerprintSkip(name)` match to **Deferred to release** without installing it. Retry **Failed** ledger rows before new names.

Completion: baseline holds iOS + Android hashes for `example-frontend` and `demo`; every candidate has name, current → target version, catalog vs workspace, security vs cooldown, and retry flag.

### 3. Exercise coverage

For each candidate, name a test file that imports the package, or write a tracer-bullet test and run it on the current version. How: [`references/exercise.md`](references/exercise.md).

Completion: every candidate attempted this run has a named exercise test that imports it.

### 4. Bump one package at a time

On `chore/update-dependencies`, for each candidate:

1. Change only the catalog pin (shared) or the one workspace `package.json` (single-use).
2. `bun install` from the repo root.
3. Run the exercise test, then compile and lint the consuming package(s).
4. Recompute all four fingerprint hashes against the baseline.

Red exercise test, failed install, or changed hash → revert that bump and its lockfile change, add a **Failed** row with the cause, continue. Do not widen a bump with `expo install --fix`. Green → commit `Bump <name> from <old> to <new>` and refresh the baseline to the new hashes.

Completion: every candidate is in Landed, Failed, Skipped, or Deferred; branch fingerprints equal the last baseline.

### 5. Batch gate (local, before push)

Run the full gate on the stacked branch. Command list and the CI job → local command map: [`references/verify-locally.md`](references/verify-locally.md).

A failure you can attribute to one bump → revert that bump, log it Failed, rerun the gate. A failure you cannot attribute, or one in CI config → stop and report; do not push.

Completion: `bun run compile`, `bun run lint`, affected package tests, and `bun run prepush` are green on the final head; any frontend-affecting bump has `verify-ui-changes` evidence; each infra job `prepush` lists (Playwright, Maestro, admin-spa integration) whose package changed was run by hand or logged as not run.

### 6. Push once and update the same PR

Push `chore/update-dependencies` one time. Update the trusted PR body ledger (do not open another), or create the PR from [`references/rolling-pr.md`](references/rolling-pr.md) when none exists. A run that landed a major says so in Last run and never enables auto-merge.

Completion: one push this run; the PR body lists this UTC date, every landed bump with its exercise command, every failure with its cause, deferred fingerprint names, and the local gate result.

### 7. Read CI, then react or stop

Wait for product CI on the pushed head. Read each failure the way [`references/read-ci.md`](references/read-ci.md) says — job `messages` first, step logs second.

- Reproduce the failure locally with the matching command, revert the bump that caused it, rerun the step 5 gate, and push again. Each push is one fix round; at most three.
- A flaky job the bumps did not cause: rerun only the failed job. That counts as a round.
- Answer every review-bot thread: fix and resolve, or reply with one sentence and resolve.
- Config, plan, infra, or secret errors (for example `resource-class-not-in-plan`) are not dependency failures. Log them in the PR body and escalate per rule 6.

Completion: CI green on the pushed head with no unanswered bot thread, or the run escalated per rule 6 with the failing job, its `messages`/log cause, and the fix-round count (at most three).

## Identity

An automation commits and pushes as whoever's git identity and GitHub token it holds. CircleCI attributes the pipeline to that GitHub user and emails them on every failed workflow. Use the bot identity when one is configured. When running as a person, batch into one push and fix CI within three rounds, so they get few emails and never a PR left red.

## Deferred native bumps

Keep them on the **Deferred to release** table and hand the list to `release` / `upgrading-expo`. Never put fingerprint-changing bumps on this branch.
