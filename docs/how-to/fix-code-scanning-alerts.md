# Fix code scanning alerts

Run `/fix-code-scanning-alerts` to clear every open CodeQL alert on one PR. When that PR merges, each alert closes: fixes close when CodeQL rescans `master`, and reviewed false positives are dismissed by a workflow.

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=100" --paginate \
  | jq -s 'add | group_by(.rule.id) | map({rule: .[0].rule.id, count: length})'
```

## How alerts close

| Lane | In the PR | After merge |
| --- | --- | --- |
| Fix | Code change and a regression test | The CodeQL push scan on `master` no longer reports it, so it closes as **fixed** |
| Dismiss | An entry in `.github/code-scanning/dismissals.json` | `code-scanning-dismissals.yml` dismisses it with the entry's reason and comment |

Dismissals wait for the merge so a reviewer approves each one, and the Security tab never shows an alert closed by an unmerged branch.

## Pieces

- `.github/codeql/codeql-config.yml`: CodeQL configuration. Test files are ignored, so their alerts close on the next `master` scan.
- `.github/workflows/codeql-analysis.yml`: also runs on pull requests, so a PR shows whether its fixes clear their alerts before merge.
- `.github/code-scanning/dismissals.json`: the dismissal ledger. Each entry has `alert`, `rule`, `path`, `reason` (`false positive`, `won't fix`, or `used in tests`), and a `comment` of 280 characters or fewer.
- `.github/workflows/code-scanning-dismissals.yml`: runs on `master` when the ledger changes, and on manual dispatch.
- `scripts/ci/codeScanning/applyDismissals.ts`: applies the ledger. It dismisses an entry only when the live alert is still open and its rule and path still match. A mismatch fails the job.

## Check a ledger locally

```bash
bun test scripts/ci/codeScanning/
GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=TerrenoLabs/terreno \
  bun scripts/ci/codeScanning/applyDismissals.ts --dry-run
```

The dry run must report `mismatched 0`.

## Rate limiting alerts

`js/missing-rate-limiting` flags every Express route because CodeQL only recognizes known limiter libraries. `TerrenoApp` mounts its own limiter before all plugins (see [Rate limiting](rate-limiting.md)), so these alerts go in the ledger as false positives. A route mounted outside `TerrenoApp` has no limiter and needs a real fix.

## Dependabot

Dependabot opens **security PRs only**. Routine upgrades go through [Update dependencies](update-dependencies.md). Every workspace package directory is listed in `.github/dependabot.yml`. Add a new package's directory there when you create it.
