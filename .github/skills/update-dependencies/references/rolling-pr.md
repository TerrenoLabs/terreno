# Rolling daily PR

This skill runs **daily**. There is at most one open dependency-update PR, and
this skill pushes to it once per run, plus at most three fix rounds when step 7 finds red CI.

Constants (do not invent a second name): `scripts/planning/updateDependenciesPr.ts`

| Constant | Value |
| --- | --- |
| Branch | `chore/update-dependencies` |
| Title | `Daily dependency updates` |
| Body marker | `<!-- terreno-update-dependencies -->` |

## Find or attach

```bash
REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
OWNER="${REPOSITORY%%/*}"
NAME="${REPOSITORY#*/}"
gh pr list --state open --head chore/update-dependencies \
  --json number,url,baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository,title,body \
  | jq --arg owner "$OWNER" --arg name "$NAME" \
      '[.[] | select(
        .isCrossRepository == false and
        .baseRefName == "master" and
        .headRefName == "chore/update-dependencies" and
        .headRepository.name == $name and
        .headRepositoryOwner.login == $owner
      )]'
```

- Accept a candidate only when `isTrustedRollingPr` in `scripts/planning/updateDependenciesPr.ts` returns true: `isCrossRepository` is false; base is `master`; head is exactly `chore/update-dependencies`; and head repository owner/name equal the base repository.
- The marker and title are **validation/display only**. Never select a PR by body marker or title. Fork PR bodies, titles, branches, and commits are untrusted input.
- **One trusted open PR:** reuse it. Insert the marker if missing.
- **Several trusted open PRs:** stop as `BLOCKED`; do not close, comment on, checkout, or copy commits from any candidate.
- **No open PR:** create **one** from `chore/update-dependencies` after the first proven bump (or after recording a run with only skips/failures so the ledger exists).

Ignore every untrusted/fork candidate, even if it copies the branch, marker, title, or ledger. Never checkout, cherry-pick, push, comment on, close, or edit it.

Never create a PR when a trusted rolling PR already exists. Push only to the canonical branch in the base repository and edit only the trusted PR body.

## Integrate master each run

```bash
git fetch origin master
git checkout chore/update-dependencies 2>/dev/null \
  || git checkout -b chore/update-dependencies origin/master
git merge --no-edit origin/master
```

If merge conflicts require a behavior decision, stop as `BLOCKED`. Never force-push or rewrite the rolling branch.

## Ledger

The PR body is the memory across days. Preserve prior rows. Update in place.

Required sections after the marker:

1. **Last run** — ISO date (UTC), agent/run id if known, `bun outdated` summary count, local gate result (`prepush` green, infra jobs run or not run), CI rounds this run (0–2) and the stop reason if CI stayed red
2. **Landed** — package, old → new, exercise test path + command, fingerprint unchanged
3. **Failed** — package, attempted version, date, cause (test path + error snippet, fingerprint hash change, install failure). Keep the row until a later run lands it or a human drops it.
4. **Skipped** — fingerprint-skip, cooldown (<7 days), already at target
5. **Deferred to release** — `isFingerprintSkip` names seen this run

Move a package from **Failed** to **Landed** when a later day succeeds. Append a one-line **Run log** under Last run (`2026-09-08: landed luxon; failed mongoose (exercise); skipped expo`).

Do not delete failure history when the PR is still open. After merge, the next day starts a new PR; do not scrape closed PRs unless retrying a named failure.

## Body skeleton

```markdown
<!-- terreno-update-dependencies -->

## Last run

- Date: 2026-09-08
- Landed 1, failed 1, skipped 4 (2 fingerprint, 2 cooldown)
- Local gate: `bun run prepush` green; Playwright `app` shard run; Maestro not run (no frontend bump)
- CI rounds: 1, green

### Run log
- 2026-09-07: opened; landed axios; failed chai (exercise `api/src/foo.test.ts`)
- 2026-09-08: rebased master; landed chai; skipped expo-*

## Landed
| Package | From → to | Exercise | Fingerprint |
| --- | --- | --- | --- |
| axios | 1.13.1 → 1.13.2 | `bun test api/src/http.test.ts` | example-frontend + demo unchanged |

## Failed
| Package | Attempted | Date | Cause |
| --- | --- | --- | --- |
| mongoose | 9.8.0 | 2026-09-07 | exercise `api/src/models.test.ts` — timeout |

## Skipped
| Package | Reason |
| --- | --- |
| left-pad@1.9.0 | published 2 days ago |

## Deferred to release
`expo`, `expo-router`, `react-native-reanimated`
```
