---
name: fix-code-scanning-alerts
description: >-
  Clear every open GitHub code scanning (CodeQL) alert in one PR: inventory the
  alerts, fix real findings in code with a regression test, record reviewed
  false positives in the dismissal ledger, open one grouped PR, and confirm
  every alert closes when it merges (fixes close on the master rescan, ledger
  entries are dismissed by a post-merge workflow). Trigger with
  /fix-code-scanning-alerts or "fix the code scanning alerts", "clear CodeQL
  alerts", "security alerts tab", "close the CodeQL findings".
---
# Fix code scanning alerts

One run clears **all** open code scanning alerts on **one** PR. Every alert
leaves the run in exactly one lane:

| Lane | When | How it closes |
| --- | --- | --- |
| **Fix** | Real or plausible risk | Code change + regression test; CodeQL stops reporting it on the master rescan → state `fixed` |
| **Dismiss** | Reviewed false positive, test-only code, or a justified won't-fix | Entry in `.github/code-scanning/dismissals.json`; `code-scanning-dismissals.yml` dismisses it after merge |

Nothing is dismissed before the PR merges. Never call the dismiss API by hand
from this skill.

Operator doc: [`docs/how-to/fix-code-scanning-alerts.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/fix-code-scanning-alerts.md).
Per-rule playbook: [`references/rules.md`](references/rules.md).
Ledger code: `scripts/ci/codeScanning/` (`dismissals.ts`, `applyDismissals.ts`).

## Hard rules

1. **Every open alert is accounted for.** At the end, each alert number is either in the fix list or in the ledger. No third bucket. An alert you cannot decide on is a blocker you report, not a silent skip.
2. **Default to fix.** Dismiss only with a concrete one-sentence reason that names where the input is constrained or which control covers it (≤ 280 chars). "Not exploitable" alone is not a reason.
3. **Fix in a shape CodeQL recognizes.** A fix CodeQL still flags will not close the alert. Use the sanitizer patterns in `references/rules.md`; the PR's CodeQL run is the proof (step 6).
4. **Regression test per fix.** Prove the malicious or pathological input is rejected or finishes fast. Follow the package's test conventions.
5. **One PR, one branch:** `fix-code-scanning-alerts` off `master`. If an open PR for that head exists, attach to it and add to its ledger and table.
6. **Ledger entries match live alerts.** `alert`, `rule`, and `path` must equal the alert's current rule id and `most_recent_instance.location.path`. `bun scripts/ci/codeScanning/applyDismissals.ts --dry-run` must report `mismatched 0`.
7. **Tests are out of scope for CodeQL.** `.github/codeql/codeql-config.yml` ignores test files, so their alerts close as `fixed` on the next master scan. Still list them in the ledger as `used in tests` so the run is deterministic.

## Procedure

### 0. Bootstrap (repositories other than TerrenoLabs/terreno)

The ledger tooling lives in TerrenoLabs/terreno. When `scripts/ci/codeScanning/applyDismissals.ts` is missing, copy it in on the PR branch (step 1) before triage:

```bash
for f in scripts/ci/codeScanning/dismissals.ts scripts/ci/codeScanning/dismissals.test.ts \
  scripts/ci/codeScanning/applyDismissals.ts .github/workflows/code-scanning-dismissals.yml \
  .github/codeql/codeql-config.yml; do
  mkdir -p "$(dirname "$f")"
  gh api "repos/TerrenoLabs/terreno/contents/$f" -H "Accept: application/vnd.github.raw" > "$f"
done
mkdir -p .github/code-scanning && echo '{"dismissals": []}' > .github/code-scanning/dismissals.json
```

Then, in the repository's CodeQL workflow, add `pull_request: branches: [<default branch>]` and `config-file: ./.github/codeql/codeql-config.yml` on `codeql-action/init`. If the repository's default branch is not `master`, change the workflow's `push` branch. Without a CodeQL workflow (default setup only), skip the PR-ref proof in step 6 and say so in the report.

Completion: `bun test scripts/ci/codeScanning/` passes.

### 1. Branch

`git fetch origin master && git checkout -b fix-code-scanning-alerts origin/master` (or check out the existing PR branch and merge `origin/master`).

Completion: on the branch, clean tree, current with master.

### 2. Inventory

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=100" --paginate \
  | jq -s 'add' > "$SCRATCH/alerts.json"
jq -r '.[] | [.number, .rule.id, .most_recent_instance.location.path, .most_recent_instance.location.start_line] | @tsv' "$SCRATCH/alerts.json" | sort -k2
jq -r '.[].rule.id' "$SCRATCH/alerts.json" | sort | uniq -c | sort -rn
```

`--paginate` is required: the API caps a page at 100. Drop alerts already in the ledger (they wait for the post-merge workflow).

Completion: total count, a per-rule count, and the list of alerts not yet in the ledger.

### 3. Triage by rule

For each rule, read its section in `references/rules.md` and decide the lane per alert. Read the alert's full message and data flow when the lane is unclear:
`gh api repos/{owner}/{repo}/code-scanning/alerts/<n>/instances`.

A rule that hits many alerts with one cause (e.g. `js/missing-rate-limiting` behind the app-level limiter) is decided once and verified once, then applied to every alert of that rule.

Completion: a table of `alert → lane → reason` covering every alert from step 2.

### 4. Fix

Group fix-lane alerts by package. When there are more than ~10, dispatch one subagent per package in parallel with a **disjoint file list**, telling each not to commit, stash, or run repo-wide formatters, and to return a JSON row per alert (`alert`, `rule`, `path`, `action`, `reason`, `comment`, `files`). A subagent may move an alert to the dismiss lane with a justification; review it before accepting.

Per package: `bun test --only-failures <touched tests>`, `bunx biome check <touched files>`, package typecheck.

Completion: every fix-lane alert has a code change and a passing test.

### 5. Ledger

Add dismiss-lane alerts to `.github/code-scanning/dismissals.json` (`reason` is one of `false positive`, `won't fix`, `used in tests`). Keep entries sorted by `alert`. Then:

```bash
bun test scripts/ci/codeScanning/
GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  bun scripts/ci/codeScanning/applyDismissals.ts --dry-run
```

Completion: tests pass; dry run says `mismatched 0, missing 0`.

### 6. Verify, commit, PR

1. Run the root `prepush` script (or lint + typecheck + affected tests) in a no-context subagent.
2. Commit by area (e.g. `Parameterize Mongo queries flagged by CodeQL`, `Record reviewed code scanning false positives`). No conventional-commit prefixes.
3. Push and open **one** PR. Body: a table of every alert (`#n`, rule, path, lane, one-line reason), grouped Fixed / Dismissed after merge, plus the counts.
4. Prove the fixes with a **full** branch scan. PR scans are diff-informed (they only report alerts on changed lines), so a clean PR check is not proof. Run `gh workflow run codeql-analysis.yml --ref fix-code-scanning-alerts`, wait for it, then for each fix-lane alert:
   ```bash
   gh api "repos/{owner}/{repo}/code-scanning/alerts/<n>/instances?ref=refs/heads/fix-code-scanning-alerts" --jq '.[0].state'
   ```
   It must print `fixed`. Calibrate with one ledger alert, which must print `open`. A fix-lane alert still `open` is not fixed: change the fix (rule 3) or move it to the ledger with a reason. The branch analysis must add no alert that is absent on `master`.
5. Hand off to `terreno:5-taste` until CI is green and review bots are answered.

Completion: PR green; the full branch scan shows every fix-lane alert `fixed` and no new alert.

### 7. After merge

Merging to master triggers two things: the CodeQL push scan (closes fixes) and `code-scanning-dismissals.yml` (dismisses ledger entries). When both finish:

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=100" --paginate | jq -s 'add | length'
```

Every alert number from step 2 must be `fixed` or `dismissed`. Report any still open by number with the reason.

Completion: the batch's alerts are all closed, or the report names each one still open.

## Report

Lead with counts: `Fixed N · Dismissed after merge M · Still open K`. Then the PR link and any still-open alert with what blocks it.
