# Update dependencies

Routine version upgrades run through the `update-dependencies` skill (`/update-dependencies`). Dependabot opens **security PRs only**. The skill keeps one rolling PR; later runs push to it and rewrite its ledger instead of opening new PRs.

```bash
REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
OWNER="${REPOSITORY%%/*}"
NAME="${REPOSITORY#*/}"
gh pr list --state open --head chore/update-dependencies \
  --json number,url,baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository \
  | jq --arg owner "$OWNER" --arg name "$NAME" \
      '[.[] | select(
        .isCrossRepository == false and
        .baseRefName == "master" and
        .headRefName == "chore/update-dependencies" and
        .headRepository.name == $name and
        .headRepositoryOwner.login == $owner
      )]'
bun outdated
```

Prove each bump with an **exercise test** that imports that package. Verify the whole batch locally, then push **once**. Keep Expo fingerprints for `example-frontend` and `demo` unchanged. Skip `isFingerprintSkip` names until a release.

Why: [Dependency management](../explanation/dependency-management.md). Native Expo/React Native bumps wait for `upgrading-expo`.

## Do now

1. Find the same-repository PR with exact head `chore/update-dependencies`, base `master`, and `isCrossRepository: false`. Marker/title matches are not trust signals; ignore forks. Merge `origin/master` without rewriting history. If no trusted PR exists, create the canonical branch on this run.
2. Inventory with `bun outdated`. Retry **Failed** rows from the PR body first. Skip `isFingerprintSkip` in `scripts/planning/fingerprintRisk.ts`.
3. For each candidate: confirm a test imports the package (add a tracer if needed), bump the catalog pin or single-use version, `bun install`, re-run that test, recompute fingerprints. Revert only that bump on failure. Commit each success as `Bump <name> from <old> to <new>`.
4. Run the batch gate on the final head: `bun run compile`, `bun run lint`, `bun run prepush`. Run by hand any infra job `prepush` lists for a package you bumped (Playwright, Maestro, admin-spa integration). See [Run tests locally](run-tests-locally.md).
5. Push once. Update the **same** PR body: Last run, local gate result, CI rounds, Landed, Failed, Skipped, Deferred to release. Do not `gh pr create` when that PR is already open.
6. Read CI on the pushed head. Check each failed CircleCI job's `messages` before its step logs. Revert a bump that caused a failure and push a second time at most; stop and report anything else.

## Guardrails

| Rule | Action |
| --- | --- |
| Trusted rolling PR already exists | Push to its same-repository `chore/update-dependencies` head and edit that body |
| Fork copies marker/title/branch | Ignore it; never checkout, copy, edit, close, or comment on it |
| Fingerprint would change | Revert that bump. Defer to a release. Never add `fingerprint-acknowledged` |
| No test imports the package | Write the tracer test first. Do not bump on `test:ci` alone |
| Published < 7 days ago (non-CVE) | Skip; log under Skipped |
| Major version | May land on the rolling PR if tests + fingerprints pass; no auto-merge |
| Local gate red | Fix or revert before pushing. CI is not the test runner |
| CI job has `messages` (for example `resource-class-not-in-plan`) | Config/plan error, not a dependency failure. Log it and stop |
| A bump seems to need CI config changes | Never edit `.circleci/`, workflows, executors, or resource classes from this path. Stop and report |
| CI red twice on heads this run pushed | Stop and report; do not push a third time |
| Dependabot security PR is red | Do not push to `dependabot/*`. Fold the bump into the rolling PR |

## Fingerprints

`example-frontend` and `demo` use `fingerprint.config.js`. Hash with `eas fingerprint:generate` when `EXPO_TOKEN` is set, otherwise `bunx @expo/fingerprint <app-dir>`. Take a baseline after rebase, before new installs. After each successful bump, the new hashes become the baseline for the next package.

`eas.json` Bun pins feed the fingerprint. Do not bump them here.

## Who CI emails

CircleCI attributes a pipeline to the GitHub user whose token pushed it and emails that user on each failed workflow. Run the scheduled agent with a bot identity when one is configured. If it runs as a person, the one-push rule caps their mail at one round per run.

## Dependabot security PRs

`.github/dependabot.yml` sets `open-pull-requests-limit: 0` on every block, so Dependabot opens no version-update PRs. Security updates still open, grouped per block, and skip ignored native/Expo names. `dependabot-auto-merge.yml` approves them and enables squash auto-merge, so a green security PR merges without this skill. A red one gets its bump folded into the rolling PR. A security fix for an ignored native package is a manual release task (`release` + `upgrading-expo`).
