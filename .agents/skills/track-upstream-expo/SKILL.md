---
name: track-upstream-expo
description: >-
  Morning job: probe for a newer Expo SDK beta, fail fast when none exists and
  no loop is open, otherwise create/continue/resume release-X.Y.Z, keep a loop
  log of tries and release notes, upgrade Expo, and land native fingerprint
  deps. Trigger with /track-upstream-expo, "track upstream expo", "check expo
  beta", or "morning expo probe".
---
# Track upstream Expo

Daily maintainer loop. Watch Expo `next` / the next SDK major. When a newer
beta exists, work on `release-X.Y.Z` (Expo `58.0.0-preview.1` →
`release-58.0.0`). If that branch is still `open` or `blocked`, resume even
when the beta did not move. Roll native-affecting catalog packages on that
branch so later master patches do not change the EAS fingerprint.

Human twin: [`docs/how-to/track-upstream-expo.md`](../../docs/how-to/track-upstream-expo.md).
Upgrade mechanics: invoke `upgrading-expo`.
Native package list: [`references/native-packages.md`](references/native-packages.md).
Loop log contract: [`references/loop-log.md`](references/loop-log.md).

## Hard rules

1. **Probe first. Exit 1 means stop.** No newer SDK **and** no resumable loop.
2. **Read `scripts/track-upstream-expo/loop-log.md` before any install or edit.**
   Tomorrow's agent has only this file and `tracked.json`.
3. **SDK majors only** for new branches. A 57.0.15 patch of the catalog major
   is not a new loop.
4. **Long-lived `release-*` branch.** Do not merge to master from this skill.
5. **Native deps ride the SDK branch.** Do not land `react-native-*` / Expo
   native module bumps on master patches.
6. **Do not retry** items in the log's **Do not retry** section unless a new
   Expo preview or new evidence landed.

## Step 1: Probe (fail fast)

From a clean `master` with `origin` fetched:

```bash
git checkout master && git pull origin master
bun run expo:track-probe
```

| Exit | `action` | Agent action |
| --- | --- | --- |
| `1` | `none` | Print JSON `reason`. **Stop.** |
| `0` | `create-branch` | New SDK line. Create `releaseBranch`. |
| `0` | `continue-branch` | Newer beta on an existing branch. Merge master, bump Expo. |
| `0` | `resume-loop` | Same beta, loop `open` or `blocked`. Checkout, read the log, work **Open**. |
| `2` | (error) | Fix network/git/registry. Do not skip the probe. |

Completion: stopped on exit `1`, or JSON has `action`, `releaseBranch`,
`expoVersion`, `loopStatus`.

Tracker: `scripts/track-upstream-expo/tracked.json`. The probe fetches
`origin` `release-*` refs, then reads that file from
`origin/<releaseBranch>` so a master-only checkout still sees an in-flight
loop.

## Step 2: Branch

`create-branch`:

```bash
git fetch origin master
git checkout -B <releaseBranch> origin/master
```

Then replace `scripts/track-upstream-expo/loop-log.md` with a filled template
from [`references/loop-log.md`](references/loop-log.md). Set **Status** and
**Next**. Set `tracked.loopStatus` to `open`.

`continue-branch` / `resume-loop`:

```bash
git fetch origin <releaseBranch> master
git checkout <releaseBranch>
git merge origin/master
```

Completion: current branch equals probe `releaseBranch`. `loop-log.md` is on
this branch.

## Step 3: Read the loop log

Open `scripts/track-upstream-expo/loop-log.md` in full. Restate in the
transcript:

1. **Next** (do this first)
2. **Open** (still owed)
3. **Do not retry** (forbidden without new evidence)

Completion: those three lists are in the transcript before any `expo install`
or source edit.

## Step 4: Install Expo (skip on `resume-loop` unless versions drifted)

On `create-branch` and `continue-branch`, pin the **exact** probe
`expoVersion`. Follow `upgrading-expo`. Write versions to the root catalog.

On `resume-loop`, skip the Expo bump when catalog already matches
`tracked.expoVersion`.

After the attempt, prepend a **Tried** entry (worked/failed + first error
line). Commit `loop-log.md` even if compile is red.

Completion: catalog Expo matches the loop target, or a **Tried** + **Do not
retry** entry explains why not.

## Step 5: Native fingerprint deps

Load [`references/native-packages.md`](references/native-packages.md). Skip
packages already listed under **Worked** at the target SDK. Skip approaches
under **Do not retry**.

Completion: every listed catalog native package is bumped, already **Worked**,
or in **Do not retry** / **Open** with the error line. None silently skipped.

## Step 6: Fix the branch

Keep going until these pass, or **Open** / **Do not retry** records the first
error line:

```bash
bun run compile
bun run lint
bun run ui:test
bun run frontend:lint
cd example-frontend && bunx expo-doctor
cd demo && bunx expo-doctor
```

Completion: commands green, or the log's **Open** names each remaining
failure.

## Step 7: Write the handoff

Update both files on the **release branch** every session:

`tracked.json`: `expoVersion`, `npmTag`, `releaseBranch`, `sdkLine`,
`updatedAt`, `loopStatus` (`open` if work remains, `blocked` if waiting on
upstream/human, `ready` if compile/lint/doctor are green).

`loop-log.md`:

1. Prepend today's **Tried** entries
2. Refresh **Open** and **Next** (one action)
3. Append new **Do not retry** / **Worked**
4. Add consumer-facing bullets to **Release notes draft**

Completion: **Next** is one concrete action. `loopStatus` matches whether
**Open** is empty. Tomorrow can start from this file alone.

## Step 8: Push

Push `release-*`. Open or update a draft PR into master. Do not merge. Title:
`Expo <sdkLine> (<expoVersion>)`. Point the PR body at `loop-log.md` (open
items + release notes draft). Do not paste the whole log into the PR.

After the push, wait for product CI and review bots on the new head (push ownership:
`plugins/terreno-planning/references/push-ownership.md`). Fix branch-caused failures and answer every bot thread, for at most three fix
rounds. Anything still red goes into **Open** with its log link, and the final message
starts with `BLOCKED — PR #<n> still red after <k> fix rounds` and names those jobs.
Never end the run quietly on a red PR.

Completion: `git ls-remote --heads origin <releaseBranch>` is non-empty and
includes `loop-log.md`; CI on the pushed head is green, or every red job is in
**Open** and was escalated.
