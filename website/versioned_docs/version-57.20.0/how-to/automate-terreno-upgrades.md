# How to automate Terreno upgrades with a scheduled agent

Run a GitHub Actions job every working hour that checks whether your app is behind the latest Terreno release. When it is, and no upgrade is already in progress, the job starts one cloud agent. The agent runs the [`upgrading-terreno`](upgrade-terreno.md) skill and opens a pull request. The job never edits the tree and cannot merge. A person reviews the pull request.

```text
cron tick ──► in working hours? ──► behind the latest GitHub release?
                                         │
                                         ▼
          release ≥ 7 days old? ──► no open upgrade PR? ──► no upgrade agent running or in cooldown?
                                         │
                                         ▼
                 npm integrity for every installed package ──► launch one agent ──► agent opens PR
```

This page is an example. Copy the workflow and adapt the script to your repository. The Terreno repository does not run it.

## Why the job only decides

A GitHub runner usually has no MongoDB, no running backend, and no browser. The upgrade skill needs all three: it starts the upgraded backend, regenerates the typed client from `/openapi.json`, and runs the app. So the job decides and enqueues. The agent runs in a cloud environment that already has your app's services, such as a Cursor Cloud Agent environment.

## Example workflow

`.github/workflows/upgrade-terreno.yml`:

```yaml
name: Upgrade Terreno

on:
  schedule:
    # 13:00–22:00 UTC covers 9:00am–5:59pm America/New_York in both EST and EDT.
    # The script drops ticks outside the local window.
    - cron: "0 13-22 * * 1-5"
  workflow_dispatch:
    inputs:
      version:
        description: "Target @terreno/* version (empty = latest GitHub release)"
        required: false
        type: string
      dry_run:
        description: "Decide only — do not launch an upgrade agent"
        required: false
        default: false
        type: boolean

permissions:
  contents: read
  pull-requests: read

# A second tick waits instead of racing the pull-request and active-agent checks.
concurrency:
  group: upgrade-terreno
  cancel-in-progress: false

jobs:
  upgrade-terreno:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.4.4"

      - run: bun install --frozen-lockfile

      - name: Launch Terreno upgrade when one is not already open
        env:
          CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TERRENO_UPGRADE_CLOUD_ENVIRONMENT: ${{ vars.TERRENO_UPGRADE_CLOUD_ENVIRONMENT }}
          TERRENO_UPGRADE_DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || 'false' }}
          TERRENO_UPGRADE_VERSION: ${{ inputs.version }}
        run: bun .github/scripts/upgrade-terreno.ts
```

The job needs read access to contents and pull requests only. The agent pushes with its own credentials.

## What the script decides

`.github/scripts/upgrade-terreno.ts` checks these in order and stops at the first one that says no. Order matters: the cheap checks run first, and no agent API call happens until every gate passes.

| Order | Check | Skip when |
| --- | --- | --- |
| 1 | Working hours | A scheduled tick lands outside weekdays 9:00am–5:59pm in your team's timezone. Use Luxon with a named zone so daylight saving does not move the window. Manual runs are not gated. |
| 2 | Installed versions | No `@terreno/*` pin is found. This is an error, not a skip. Read every manifest that pins Terreno. With a Bun catalog, the versions live in the root `package.json` under `workspaces.catalog` (and `workspaces.catalogs.<name>`); workspace packages say `catalog:`. |
| 3 | Target version | The lowest installed pin already equals the target, or any pin is newer than it. Never downgrade. Resolving the target fails the job when `@terreno/api` at that version is not on npm yet; see below. |
| 4 | Release age | A scheduled run targets a release under 7 days old. A manual run is the human gate and is not held. |
| 5 | Open pull request | Any open pull request is an upgrade: its title names a Terreno upgrade, its branch contains `upgrade-terreno`, or its body has the `<!-- terreno-upgrade -->` marker. |
| 6 | Running agent | An upgrade agent (name starts with `Upgrade Terreno`) is still running. |
| 7 | Cooldown | An agent for the same target version was created in the last 24 hours, even one that finished or failed. Without this, a broken upgrade is retried every hour. |
| 8 | npm integrity | Any installed package has no published `dist.integrity` for the target. |

Take the target from the latest stable [TerrenoLabs/terreno GitHub release](https://github.com/TerrenoLabs/terreno/releases), not the npm `latest` dist-tag. Reject drafts, prereleases, and tags that are not semver. Validate a manual `version` input as semver before using it.

Write the decision to `$GITHUB_STEP_SUMMARY` so each run says why it skipped:

```text
## Terreno upgrade

- Decision: skipped (open-pull-request)
- Detail: Open Terreno upgrade pull request #261 (Upgrade Terreno to 57.19.2).
- From: 57.16.2
- To: 57.19.2
```

The job fails, rather than skips, in two cases:

- A launch would happen and `CURSOR_API_KEY` is missing. A skip with no key is still green.
- The latest GitHub release exists but `@terreno/api` at that version is not on npm. This check runs while the target is resolved, before the release-age and open-pull-request gates, so every in-hours run is red until publishing finishes. That points at a stuck release. If you would rather skip quietly, return a skip from that check instead of throwing.

## The agent prompt

The skill stops for confirmation unless the invoking task names both versions and authorizes the bump. The prompt does that, so the agent prints its plan into the transcript and continues:

```text
Upgrade Terreno from 57.16.2 to 57.19.2.

This unattended task names fromVersion 57.16.2 and toVersion 57.19.2 and authorizes the
lockstep bump. Follow the upgrading-terreno skill. Print the plan into the transcript, then
perform the upgrade. Do not wait for confirmation.

Check out the latest origin/master and create a feature branch before editing. Do not commit
to master.

Bump every already-installed @terreno/* dependency to 57.19.2. Do not add @terreno packages
that are not already installed.

Installed pins:
package.json workspaces.catalog @terreno/api@57.16.2
package.json workspaces.catalog @terreno/ui@57.16.2

The target is the TerrenoLabs/terreno GitHub release 57.19.2, not the npm latest dist-tag.
Install these exact versions. npm dist.integrity:
@terreno/api@57.19.2 sha512-…
@terreno/ui@57.19.2 sha512-…

Open exactly one pull request against master. Put <!-- terreno-upgrade --> in its body.
```

Add the repo-specific steps the skill cannot know, such as which apps run `bun run sdk`. Install the skill in the app first ([install agent skills](install-agent-skills.md)); otherwise the agent has nothing to follow.

Name the agent `Upgrade Terreno to <version>` so checks 6 and 7 can find it.

## Test the script

Inject the I/O (manifest reads, GitHub, npm, the agent API, and the clock) as dependencies and test the decision function with fakes. Cover at least:

- A scheduled tick at 8:59am and 6:00pm local time in both winter and summer
- Already current, and a pin newer than the target
- A 6-day-old release on a schedule, and the same release on a manual run
- Each open pull request signal on its own
- A finished agent for the same version inside and outside the cooldown
- A package with no npm integrity
- A dry run that reports `launch` without calling the agent API

## Try it

Run the workflow manually with `dry_run` checked. The summary shows the decision without launching anything. Then run it locally:

```bash
GITHUB_EVENT_NAME=workflow_dispatch \
GITHUB_REPOSITORY=<owner>/<repo> \
GITHUB_TOKEN=$(gh auth token) \
TERRENO_UPGRADE_DRY_RUN=true \
bun .github/scripts/upgrade-terreno.ts
```
