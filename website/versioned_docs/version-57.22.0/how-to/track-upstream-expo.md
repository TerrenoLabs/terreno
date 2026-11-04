# Track upstream Expo SDK betas

Morning maintainer loop: see if Expo published a **new SDK major beta**, keep
a long-lived `release-X.Y.Z` branch building, and leave a log so the next
morning can resume.

Agent procedure: skill `track-upstream-expo`. Upgrade commands: skill
`upgrading-expo`. Log contract: skill reference `loop-log.md`.

## 1. Probe

From latest `master`:

```bash
bun run expo:track-probe
```

| Exit | Meaning |
| --- | --- |
| `1` | Nothing newer **and** no `open`/`blocked` loop. Stop. |
| `0` | `create-branch`, `continue-branch` (newer beta), or `resume-loop` (same beta, unfinished). |
| `2` | Probe broke (network/git). Fix that; do not skip. |

The probe ignores patches of the current catalog major. It watches
`expo@next` and `expo@latest` for a **higher major**, fetches `origin`
`release-*` refs, then reads `loopStatus` from
`origin/<releaseBranch>:scripts/track-upstream-expo/tracked.json`.

State files (in the repo, not linked from this page):

- `scripts/track-upstream-expo/tracked.json` — `expoVersion`, `loopStatus`
- `scripts/track-upstream-expo/loop-log.md` — tries, failures, release-notes draft

## 2. Branch name

Expo `58.0.0-preview.1` → `release-58.0.0`. Create from `origin/master` the
first day. Later days check it out, merge `master`, and either bump to a
newer preview or resume **Open** items from the log.

Do not merge `release-*` to master from this job.

## 3. Native modules stay on the SDK train

Packages that change the EAS fingerprint update **on this branch only**.

## 4. Handoff every session

Before edits: read `loop-log.md` (**Next**, **Open**, **Do not retry**).

After edits: prepend **Tried**, refresh **Next** / **Open**, extend
**Release notes draft**, set `loopStatus` to `open`, `blocked`, or `ready`,
and push the release branch. Tomorrow starts from that commit.
