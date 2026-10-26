# How to let agents merge release notes and roadmap updates

An agent (or the scheduled roadmap workflow) opens a pull request. The **Bot merge** workflow
([`.github/workflows/bot-merge.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/bot-merge.yml))
merges it after CI passes. No human review is needed. For a release it then tags the merged commit,
and that tag starts CircleCI `publish-release`. The packages are built from the tagged commit, so the
release notes are already in each npm tarball.

```text
release/X.Y.Z PR ──► Bot merge waits for CI ──► squash-merge (bot bypass)
                                                   │
                                                   ▼
                     tag X.Y.Z on the squash commit + draft GitHub release
                                                   │
                                                   ▼
            CircleCI publish-release: require merged notes ──► npm publish
                                                    (every tarball ships CHANGELOG.md)
```

## What the bot merges

[`scripts/ci/release/lib.ts`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/ci/release/lib.ts)
(`planBotMerge`) decides eligibility. A pull request qualifies only if all of these are true:

- It comes from a branch in this repository. Drafts and forks are skipped.
- Its author is listed in the `BOT_MERGE_AUTHORS` repository variable.
- Its branch name and changed files match one of the rows below.

| Branch | Files it may change |
|--------|---------------------|
| `release/X.Y.Z` or `cursor/release-X.Y.Z` (stable versions only) | `CHANGELOG.md`, `changelog/unreleased/*`, `example-frontend/constants/whatsNew.generated.json`, `mcp-server/src/docs/upgrades/*.md` |
| `automation/roadmap-*` | `ROADMAP.md`, `docs/explanation/roadmap-seed-issues.md` |

A release branch also needs a non-empty `## [X.Y.Z]` section in its `CHANGELOG.md`. The workflow
uses `pull_request_target`, so both the workflow file and the eligibility script come from
`master`. A pull request cannot change its own eligibility rules. The job never runs pull request
code; it reads file names and `CHANGELOG.md` through the API. Any pull request that fails a rule keeps a green **Bot merge** check and waits
for a human. Examples are a release pull request that also edits a skill, or a prerelease branch.

The `master` ruleset requires no status checks, so the workflow does that job itself. It waits
until every other check on the head commit has passed, including GitHub Actions and CircleCI
statuses. It merges with the head SHA pinned, so a push made after the checks finished blocks the
merge.

## The publish gate

`publish-release` runs
`bun run scripts/ci/release/cli.ts check-tag <tag> <on-master>` before it compiles anything. A
stable tag fails if any of these is true:

- The tagged commit is not on `master`.
- `CHANGELOG.md` has no non-empty `## [X.Y.Z]` section.
- Fragments are left in `changelog/unreleased/`.

Prerelease tags (`-beta.N`) skip the gate; they are often cut from a feature branch.

`scripts/ci/prepare-package-publish.mjs` copies the root `CHANGELOG.md` into each package before
`npm publish`. Packages that declare a `files` whitelist list `CHANGELOG.md` in it.

## One-time GitHub setup

1. Create a GitHub App under **TerrenoLabs → Settings → Developer settings → GitHub Apps**. Turn
   off webhooks. Give it these repository permissions:
   - Contents: read and write
   - Pull requests: read and write
   - Metadata: read

   Install it on `TerrenoLabs/terreno` only.
2. Generate a private key. Add it as the repository secret `BOT_MERGE_PRIVATE_KEY`. Add the
   App ID as the repository variable `BOT_MERGE_APP_ID`.
3. Set the repository variable `BOT_MERGE_AUTHORS` to the logins allowed to open bot-merged pull
   requests, separated by commas. Include the account that owns `ROADMAP_PROJECT_TOKEN`, which
   opens the roadmap pull requests.
4. Add the App as an **Always** bypass actor on both `master` rulesets (**Branch** and
   **master protection**). Its token can then squash-merge without an approving review.

Once these are set, the agent's job ends at opening the pull request. Steps 5b–5c of the
[`release` skill](https://github.com/TerrenoLabs/terreno/blob/master/.rulesync/skills/release/SKILL.md)
describe that hand-off.
