# Upgrade Terreno

Bump every `@terreno/*` package together. Mixing versions is unsupported ([versioning policy](../explanation/versioning-policy.md)).

## 1. Check current versions

From the app root:

```bash
bun pm ls --all | rg '@terreno/'
```

Or call MCP `application_info` (`terreno-mcp-local`) and read each `package.json`. Record the lowest `@terreno/*` version as `fromVersion` and the target as `toVersion` (usually the latest tag on [GitHub Releases](https://github.com/TerrenoLabs/terreno/releases)).

## 2. Fetch notes for the range

```text
terreno_get_upgrade_guide({ fromVersion, toVersion })
```

Or browse [`mcp-server/src/docs/upgrades/`](../../mcp-server/src/docs/upgrades/). The tool lists recorded notes and names same-major minors with no file — a gap is not “nothing changed.”

## 3. Order (do not skip)

| Step | Why |
| --- | --- |
| Clean git tree, work on a branch | Rollback is `git checkout -- .` / `git reset --hard` on that branch. |
| Backend `@terreno/*` first | `/openapi.json` is the contract the frontend typed client is generated from. Regenerating against an old backend omits new routes; screens fail at compile. |
| Backend compile + tests | Catch API breaks before touching Expo or UI. |
| Expo SDK (if the Terreno major tracks a new Expo) | `@terreno/ui` pins `react-native` (for example `0.88.0-rc.1` on the 58 line in `ui/package.json` `peerDependencies`). Installing Terreno frontend packages before Expo leaves unmet peers. |
| Frontend `@terreno/*` | UI, syncdb, admin-frontend, admin-spa. |
| Regenerate typed client | Only after the **upgraded** backend is running. |
| Compile, lint, tests | Whole app. |
| Run the app | UI verification. |

Use the `upgrading-expo` skill at the Expo step. Do not copy Expo’s checklist into a Terreno-only bump.
Maintainers watching the next SDK beta use `track-upstream-expo` / [`track-upstream-expo.md`](track-upstream-expo.md) instead of mixing native bumps onto master.

### Backend vs frontend packages

From `publish-on-tag.yml`: **backend** `api`, `test`, `admin-backend`, `blocks`, `ai`, `api-health`, `comms`, `feature-flags`, `mcp`. **frontend** `ui`, `syncdb`, `admin-frontend`, `admin-spa`. `blocks` holds contracts that both `ai` and `ui` depend on, so it moves with the backend step.

## 4. Crossing 58 removes `@terreno/rtk`

If the range crosses `58.0.0`, the app must drop `@terreno/rtk` and Redux: there is no 58 release of `@terreno/rtk`. Follow [How to upgrade from @terreno/rtk to @terreno/syncdb (Terreno 58)](migrate-rtk-to-syncdb.md) as part of the upgrade. Run the 58 data migrations before deploying 58 frontends.

## 5. Manual steps

1. Branch from a clean tree. Confirm tests pass on HEAD so later failures are from the upgrade.
2. Print `fromVersion`, `toVersion`, notes, affected packages, and this order. **Stop until the human confirms.**
3. Bump backend packages to `toVersion`. `bun install`. `bun run compile` and backend tests.
4. If Expo must move, run `upgrading-expo`, then rebuild native binaries.
5. Bump frontend packages. `bun install`.
6. Start the upgraded backend. `cd <frontend> && bun run sdk`.
7. `bun run compile`, `bun run lint`, and the app test suite.
8. Log in and exercise the screens that use changed APIs.

Stop at the first failed compile or test. Do not continue. Compile is a typecheck (`tsc --noEmit`); a bundler that ignores types is not enough.

## 6. Verification

- Every `@terreno/*` version in the lockfile is `toVersion`.
- `terreno_get_upgrade_guide` verification sections for notes in the range all pass.
- App boots; auth and one write path work.

## 7. Rollback

On the upgrade branch, with no extra uncommitted work you need:

```bash
git status --short   # only upgrade edits
git reset --hard HEAD
# or restore the previous lockfile commit:
git checkout <pre-upgrade-sha> -- package.json bun.lock
bun install
```

If you already committed, `git revert` the upgrade commit or reset the branch to the pre-upgrade SHA before it was pushed. Do not leave a half-upgraded lockfile on `master`.
