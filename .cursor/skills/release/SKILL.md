---
name: release
description: Cut a Terreno release — organize commits since the last tag into useful release notes, flag breaking changes, decide the semver version, open a changelog pull request, merge it as soon as CI is green, create the GitHub release, and monitor the CircleCI publish until every package is on npm. Trigger with /release.
disable-model-invocation: true
---
# Release Terreno

One `/release` finishes the release. Do not stop after opening a pull request or after writing notes. Assemble the changelog, merge that pull request as soon as CI is green, push the tag, and watch npm until every published package is live.

## How releases work in this repo

- Pushing a tag matching `X.Y.Z` (no `v` prefix, e.g. `57.10.0`) triggers CircleCI `publish-release` (`.circleci/continue-config.yml`). That job checks upgrade notes, compiles once, publishes in parallel, bumps package versions on master, and notifies Zoom. For stable `X.Y.Z` tags it also runs `deploy-demo`.
- `.github/workflows/publish-on-tag.yml` is `workflow_dispatch` only. Do not dispatch it after CircleCI has published: npm versions are immutable, so a second publish of the same version fails.
- CircleCI publishes these packages, all at the same version: `@terreno/api`, `@terreno/test`, `@terreno/blocks`, `@terreno/ui`, `@terreno/rtk`, `@terreno/admin-backend`, `@terreno/admin-frontend`, `@terreno/admin-spa`, `@terreno/ai`, `@terreno/api-health`, `@terreno/announcements`, `@terreno/comms`, `@terreno/feature-flags`, `@terreno/jobs`, `create-terreno-app`, `@terreno/mcp`, `@terreno/syncdb`. (`demo`, the example apps, and `@terreno/cli` are not in that job.)
- `publish-release` runs `bun run check:upgrade-docs` against the tag first. That check fails the release when the tag's `CHANGELOG.md` has a `### Breaking`, `### Changed`, `### Deprecated`, or `### Removed` section for the version but `mcp-server/src/docs/upgrades/<version>.md` is missing. The assembled changelog and the upgrade note must already be on master.
- Prerelease tags (`-beta`, `-alpha`) publish to their prerelease npm dist-tag and skip the master version bump. `deploy-demo` runs only for tags with no prerelease suffix.
- Docs version snapshots are not cut by the tag pipeline. Do not wait for a `chore: cut docs version` commit, and do not dispatch the GitHub publish workflow to cut them.

## Step 1: Preflight

1. Release from latest master with a clean tree:

   ```bash
   git checkout master && git pull origin master && git fetch --tags origin
   git status --short  # must be empty
   ```

2. Verify `gh` auth (`gh api user -q .login`). If not logged in, export `GH_TOKEN` from the environment's GitHub token.
3. Find the last release and confirm tag and GitHub release agree:

   ```bash
   git tag --sort=-v:refname | head -1
   gh release list --limit 3
   ```

## Step 2: Collect the commits

```bash
git log <last-tag>..HEAD --oneline --no-merges
```

- If there are no commits, or the only commits are `chore: bump package versions ...` / lockfile-only changes, **stop — there is nothing to release**. Do not cut empty releases.
- For any commit whose one-liner is unclear, pull PR context: `gh pr view <num> --json title,body,labels`.

## Step 3: Decide the version

- **Major**: pinned to the Expo SDK major. While the repo is on Expo 54/55 the major stays `0` (releases are `0.x.y`). Once the monorepo upgrades to Expo 56, releases become `56.x.y`, and each subsequent Expo SDK upgrade bumps the major to match.
- **Minor**: standard semver — new features, new components/routes/exports, new `modelRouter` options, or any non-breaking API addition. While the major is `0`, breaking changes also bump the minor (semver 0.x convention) and must be called out in the notes. While the major is pinned to an Expo SDK, breaking changes also bump the minor and must be called out in the notes.
- **Patch**: standard semver — bug fixes, performance work, and releases containing only docs, CI/workflow, skills/rules, test-coverage (`[coverage]`, `[alignRules]`), or dependency-bump commits.
- **Prerelease**: append `-beta.1` (etc.) to test the publish pipeline without moving `latest` or bumping versions on master.

## Step 4: Identify breaking changes

Scan the diff and PR bodies for anything a consumer must act on:

- Removed or renamed exports — check the export surface directly:

  ```bash
  git diff <last-tag>..HEAD -- api/src/index.ts ui/src/index.tsx rtk/src/index.ts blocks/src/index.ts ai/src/index.ts
  ```

- Changed function signatures or component prop types in published packages.
- Removed/renamed `modelRouter` options, permissions, or auth behavior changes.
- Mongoose schema changes that require a migration.
- Peer dependency major bumps (expo, react-native, react, mongoose).
- New required or renamed environment variables.

Every breaking change gets its own bullet in the notes: what broke and how to migrate. If there are none, omit the section entirely — don't write "No breaking changes".

## Step 5: Write the release notes

Organize the commits — never ship the raw auto-generated list. Order sections by how much the reader needs them, and push mechanical commits to the bottom:

```markdown
## Breaking changes
- `modelRouter`'s `foo` option was removed — pass `bar` instead. (#123)

## Features
- modelRouter actions: declare `instanceActions` / `collectionActions` for custom RPC-style endpoints. (#715)

## Fixes
- Fix consent signature layout and EAS dev builds. (#706)

## Docs & tooling
- Add design-blend skill with REST-first planning workflow. (#734)

## Tests & housekeeping
<details><summary>Coverage, rule-alignment, and chore commits</summary>

- [coverage] Button.tsx, realtime.ts (#728)
- Update workspace versions in bun lockfile (#735)
</details>

**Full Changelog**: https://github.com/TerrenoLabs/terreno/compare/<last-tag>...<new-version>
```

Rules:

- Lead with breaking changes, then features, then fixes. Omit empty sections.
- `[coverage]`, `[alignRules]`, lockfile updates, `update-dependencies` bumps, and similar mechanical commits go in the collapsed **Tests & housekeeping** section, one line each.
- Expo SDK, React Native, and other `isFingerprintSkip` packages are **not** bumped by `update-dependencies`. Include those native upgrades in this release (see `upgrading-expo`).
- Merge commits that belong to one feature (e.g. an IP/plan commit plus its implementation) into a single bullet.
- Describe user-facing impact, not implementation detail. Keep `(#123)` PR references — GitHub autolinks them.
- Save the notes to `/tmp/release-notes.md`. They are posted in Step 6, after the changelog pull request is on master.

## Step 5b: Assemble `CHANGELOG.md` from fragments (required)

PRs do not edit `CHANGELOG.md` as they land. User-facing work lands as one file per feature in [`changelog/unreleased/`](../../changelog/unreleased/) with a YAML `category` header (`Breaking`, `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`).

Before creating the tag:

1. Preview pending notes: `bun run changelog:preview`. If there are no fragments, stop — do not cut an empty release (see Step 2). If a user-facing feature in the commit range has no fragment, add one before assembling so the changelog matches what shipped.
2. Run `bun run changelog:assemble X.Y.Z`. That command uses today's ISO date via Luxon (`DateTime.now().toISODate()`), folds fragments into a new `## [X.Y.Z] - YYYY-MM-DD` section in [`CHANGELOG.md`](../../CHANGELOG.md), leaves `## [Unreleased]` as a pointer at `changelog/unreleased/`, and deletes the assembled fragment files.
3. Confirm the new version section is **non-empty** and grouped under Keep a Changelog headings.
4. If the new section has a `### Breaking`, `### Changed`, `### Deprecated`, or `### Removed` heading, write `mcp-server/src/docs/upgrades/X.Y.Z.md` **in the same commit as the assembled changelog**, using the template in [`mcp-server/src/docs/upgrades/README.md`](../../mcp-server/src/docs/upgrades/README.md). Add a changelog line `Upgrade note: [\`mcp-server/src/docs/upgrades/X.Y.Z.md\`](mcp-server/src/docs/upgrades/X.Y.Z.md).` under the version heading. The tag-time upgrade-docs check fails the release without the file. Verify locally with `bun run check:upgrade-docs X.Y.Z`.
5. If this skill (or another `.rulesync/` source) needs to change, edit `.rulesync/` in this same commit, run `bun run rules`, then run `bun run skills:sync` so `skills/release/SKILL.md` matches. `bun run rules:check` must pass. Commit the generated copies in the changelog pull request.

## Step 5c: Open the changelog pull request and merge it when CI is green (required)

Never commit the release directly to master, and never tag before this pull request is merged. Master accepts changes through a squash merge.

1. From latest master, create and push `release/X.Y.Z` with the assembled changelog, deleted fragments, upgrade note, and any skill updates. A Cursor cloud agent whose forge requires a `cursor/` prefix uses `cursor/release-X.Y.Z` instead.
2. Open the pull request against master:

   ```bash
   gh pr create --base master --title "Assemble Terreno X.Y.Z release notes" --body-file /tmp/release-pr.md
   ```

3. Wait until every check on the pull request head has finished and succeeded. Pending and failing checks block the merge. A check that was cancelled because a newer run replaced it does not count; the latest run of each workflow must be green. If a check fails for a real reason, fix it on `release/X.Y.Z` and wait again.

   ```bash
   gh pr checks --watch
   ```

4. As soon as those checks are green, squash-merge. Do not wait for a second reviewer. Master requires one approving review; the release maintainer is a ruleset bypass actor, so merge with admin:

   ```bash
   gh pr merge --squash --admin --delete-branch
   ```

   If GitHub rejects the merge, stop and report. Do not create the tag.

5. Update local master and confirm the squash commit is the tip:

   ```bash
   git checkout master && git pull origin master
   ```

## Step 6: Create the release

Only after Step 5c is on master. This pushes the tag and starts CircleCI `publish-release`:

```bash
gh release create "$VERSION" --target master --title "$VERSION" --notes-file /tmp/release-notes.md
```

## Step 7: Monitor the publish and verify npm

1. Watch the tag commit until `ci/circleci: publish-release` succeeds. Do not watch `publish-on-tag.yml` — that workflow does not run on tag push.

   ```bash
   SHA=$(git rev-parse "$VERSION")
   # Poll until publish-release is success. Failure stops the release.
   gh api "repos/TerrenoLabs/terreno/commits/$SHA/status" \
     --jq '.statuses[] | select(.context == "ci/circleci: publish-release") | {state, target_url}'
   ```

   For a stable `X.Y.Z` tag, `ci/circleci: deploy-demo` runs alongside publish and should also succeed.

2. Verify every package CircleCI publishes is live on npm (allow a couple of minutes of registry lag):

   ```bash
   for p in @terreno/api @terreno/test @terreno/blocks @terreno/ui @terreno/rtk @terreno/admin-backend @terreno/admin-frontend @terreno/admin-spa @terreno/ai @terreno/api-health @terreno/announcements @terreno/comms @terreno/feature-flags @terreno/jobs create-terreno-app @terreno/mcp @terreno/syncdb; do
     echo "$p: $(npm view "$p" version)"
   done
   ```

   All seventeen must report `$VERSION`.

3. Confirm the `chore: bump package versions to $VERSION` commit landed on master (`git fetch origin master && git log origin/master -1 --oneline`). Skipped for prereleases.

4. **Announce breaking changes or deprecations** — post a [Discussions → Announcements](https://github.com/TerrenoLabs/terreno/discussions/categories/announcements) thread summarizing what changed, linking the `## Breaking changes` section of the release notes, the matching `CHANGELOG.md` entry, and the upgrade note in `mcp-server/src/docs/upgrades/$VERSION.md` when one exists.

5. After editing this skill or other `.rulesync/` sources, run `bun run rules` and `bun run skills:sync`, and confirm `bun run rules:check` passes. That edit belongs in the Step 5c pull request, before the tag.

## Step 8: If a publish job fails

1. Open the `ci/circleci: publish-release` target URL from the tag status. CircleCI holds the job log.
2. Transient failure (network, registry flake): rerun the failed CircleCI job.
3. Real failure needing a code fix: fix it via a normal PR. npm versions are immutable, so if **any** package already published for this version, do not reuse the tag — merge the fix and release the next patch version. Only if nothing published may you delete the release and tag (`gh release delete "$VERSION" --cleanup-tag`) and re-create it from the fixed master. Do not dispatch `.github/workflows/publish-on-tag.yml` for a version CircleCI already published.
4. Report the final per-package publish status either way.
