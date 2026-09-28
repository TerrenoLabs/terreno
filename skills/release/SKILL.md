---
name: release
description: Cut a Terreno release — organize commits since the last tag into useful release notes, flag breaking changes, decide the semver version, create the GitHub release, and monitor the publish-on-tag workflow until every package deploys to npm. Trigger with /release.
disable-model-invocation: true
---

# Release Terreno

Cut a new Terreno release end-to-end: gather commits, write organized release notes, pick the version, create the GitHub release (which pushes the tag), and watch the npm publish workflow until all packages are live.

## How releases work in this repo

- Pushing a tag matching `X.Y.Z` (no `v` prefix, e.g. `0.18.0`) triggers `.github/workflows/publish-on-tag.yml`.
- That workflow publishes **fifteen packages, all at the same version**: `@terreno/api`, `@terreno/test`, `@terreno/blocks`, `@terreno/ui`, `@terreno/rtk`, `@terreno/admin-backend`, `@terreno/admin-frontend`, `@terreno/admin-spa`, `@terreno/ai`, `@terreno/api-health`, `@terreno/comms`, `@terreno/feature-flags`, `@terreno/jobs`, `@terreno/mcp`, `@terreno/syncdb`. (`demo` and the example apps are not published.)
- Every publish job waits on `breaking-change-documentation`, which runs `bun run check:upgrade-docs "<tag>"` against the tagged commit. That job fails the whole release when the tag's `CHANGELOG.md` has a `### Breaking`, `### Changed`, `### Deprecated`, or `### Removed` section for the version but `mcp-server/src/docs/upgrades/<version>.md` is missing — so assembled changelog entries and the upgrade note must be on master *before* tagging.
- Publish jobs are chained: `ui` depends on `publish-blocks`; `rtk`, `admin-frontend`, and `admin-spa` depend on `publish-ui`; `ai` depends on `publish-api`, `publish-test`, and `publish-blocks`; `admin-backend`, `api-health`, `comms`, `feature-flags`, `jobs`, and `mcp` depend on `publish-api` and `publish-test`; `admin-spa` also waits on `publish-rtk` and `publish-admin-frontend`. `api`, `test`, `blocks`, and `syncdb` publish independently. A `blocks`, `ui`, `api`, or `test` failure cascades.
- After the master version bump, the workflow dispatches `demo-deploy.yml` against the release tag, and for `X.Y.0` tags also cuts the versioned docs.
- After successful publishes, the workflow commits `chore: bump package versions to X.Y.Z` back to master and sends a Zoom notification. Prerelease tags (`-beta`, `-alpha`) skip the master bump.

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
- **Minor**: standard semver — new features, new components/routes/exports, new `modelRouter` options, or any non-breaking API addition. While the major is `0`, breaking changes also bump the minor (semver 0.x convention) and must be called out in the notes.
- **Patch**: standard semver — bug fixes, performance work, and releases containing only docs, CI/workflow, skills/rules, test-coverage (`[coverage]`, `[alignRules]`), or dependency-bump commits.
- **Prerelease**: append `-beta.1` (etc.) to test the publish pipeline without moving `latest` or bumping versions on master.

## Step 4: Identify breaking changes

Scan the diff and PR bodies for anything a consumer must act on:

- Removed or renamed exports — check the export surface directly:

  ```bash
  git diff <last-tag>..HEAD -- api/src/index.ts ui/src/index.tsx rtk/src/index.ts
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

## Step 5b: Assemble `CHANGELOG.md` from fragments (required)

PRs do not edit `CHANGELOG.md`. User-facing work lands as one file per feature in [`changelog/unreleased/`](../../changelog/unreleased/) with a YAML `category` header (`Breaking`, `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`).

Before creating the tag:

1. Preview pending notes: `bun run changelog:preview`. If there are no fragments, stop — do not cut an empty release (see Step 2).
2. Run `bun run changelog:assemble X.Y.Z`. That command uses today's ISO date via Luxon (`DateTime.now().toISODate()`), folds fragments into a new `## [X.Y.Z] - YYYY-MM-DD` section in [`CHANGELOG.md`](../../CHANGELOG.md), leaves `## [Unreleased]` as a pointer at `changelog/unreleased/`, and deletes the assembled fragment files.
3. Confirm the new version section is **non-empty** and grouped under Keep a Changelog headings.
4. If the new section has a `### Breaking`, `### Changed`, `### Deprecated`, or `### Removed` heading, write `mcp-server/src/docs/upgrades/X.Y.Z.md` **in the same commit as the assembled changelog**, using the template in [`mcp-server/src/docs/upgrades/README.md`](../../mcp-server/src/docs/upgrades/README.md). Add a changelog line `Upgrade note: [\`mcp-server/src/docs/upgrades/X.Y.Z.md\`](mcp-server/src/docs/upgrades/X.Y.Z.md).` under the version heading. The tag-time `breaking-change-documentation` job fails the release without the file. Verify locally with `bun run check:upgrade-docs X.Y.Z`.
5. Commit the assembled changelog, deleted fragments, and the upgrade note on `master` before tagging. When `master` requires a PR, merge that PR first and only then create the release, so the tagged commit contains both files.

## Step 6: Create the release

Write the notes to a file, then create the release targeting master (this pushes the tag and starts the publish workflow):

```bash
gh release create "$VERSION" --target master --title "$VERSION" --notes-file /tmp/release-notes.md
```

## Step 7: Monitor the publish and verify npm

1. Watch the workflow until it finishes:

   ```bash
   RUN_ID=$(gh run list --workflow=publish-on-tag.yml --branch "$VERSION" --limit 1 --json databaseId -q '.[0].databaseId')
   gh run watch "$RUN_ID" --exit-status
   ```

2. Verify every package is live on npm (allow a couple of minutes of registry lag):

   ```bash
   for p in api test blocks ui rtk admin-backend admin-frontend admin-spa ai api-health comms feature-flags jobs mcp syncdb; do
     echo "@terreno/$p: $(npm view "@terreno/$p" version)"
   done
   ```

   All fourteen must report `$VERSION`.

3. Confirm the `chore: bump package versions to $VERSION` commit landed on master (`git fetch origin master && git log origin/master -1 --oneline`). Skipped for prereleases.

4. For `X.Y.0` releases (minor/major), confirm the `chore: cut docs version $VERSION` commit landed and the docs site deployed (`docs-deploy` workflow). Patch releases rebuild the current docs version in place.

5. **Announce breaking changes or deprecations** — post a [Discussions → Announcements](https://github.com/TerrenoLabs/terreno/discussions/categories/announcements) thread summarizing what changed, linking the `## Breaking changes` section of the release notes, the matching `CHANGELOG.md` entry, and the upgrade note in `mcp-server/src/docs/upgrades/$VERSION.md` when one exists.

6. After editing this skill or other `.rulesync/` sources, run `bun run rules` and confirm `bun run rules:check` passes.

## Step 8: If a publish job fails

1. Inspect: `gh run view "$RUN_ID" --log-failed`.
2. Transient failure (network, registry flake): `gh run rerun "$RUN_ID" --failed`.
3. Real failure needing a code fix: fix it via a normal PR. npm versions are immutable, so if **any** package already published for this version, do not reuse the tag — merge the fix and release the next patch version. Only if nothing published may you delete the release and tag (`gh release delete "$VERSION" --cleanup-tag`) and re-create it from the fixed master.
4. Report the final per-package publish status either way.
