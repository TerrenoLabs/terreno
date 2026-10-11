# Dependency Management

Terreno pins shared versions in the Bun catalog, lands routine JavaScript updates
through an agent skill that proves each bump with a test, limits Dependabot to
security fixes, and keeps Expo native fingerprints frozen until a release.

## Layers

| Layer | Job |
| --- | --- |
| **Bun catalog** | One version for every dependency shared by two or more workspace packages (`catalog:` in manifests) |
| **`update-dependencies` skill** | The only path for routine version upgrades. Daily rolling PR on `chore/update-dependencies`: cooldown, exercise test, local gate, one push per run, fingerprint freeze, ledger of landed/failed |
| **Dependabot** | Security updates only for bun + GitHub Actions. Native/Expo catalog names are ignored so auto-merge cannot change the fingerprint |
| **Release + `upgrading-expo`** | Expo SDK, React Native, and other native-module bumps |

Operator steps: [Update dependencies](../how-to/update-dependencies.md). Catalog rule: workspace `package.json` files use `"catalog:"` for shared pins.

## Bun catalogs

Shared versions live in the root `package.json` `catalog` field.

```json
{
  "catalog": {
    "react": "19.1.0",
    "react-native": "0.81.5"
  }
}
```

```json
{
  "dependencies": {
    "react": "catalog:",
    "react-native": "catalog:"
  }
}
```

Change a shared version in the catalog once. Do not pin a second copy in a workspace package. Exceptions (`@types/node`, `path-to-regexp`, `@opentelemetry/sdk-node`) are listed in `.rulesync/rules/01-dependency-catalog.md`.

## Agent updates vs Dependabot

Dependabot version updates group many packages and merge when CI is green. That misses Terreno constraints, so Dependabot now opens security PRs only:

1. **Exercise.** CI can pass without any test importing the bumped module. The skill requires a named test file that imports the package and that passed **after** the bump. If none exists, write a tracer-bullet test first.
2. **Fingerprint.** Expo `runtimeVersion.policy: "fingerprint"` ties OTA runtime and EAS dev builds to native hashes of `example-frontend` and `demo`. Native module bumps belong in a release, not a weekday dependency PR.

3. **CI is not the test runner.** A red grouped Dependabot PR invites an agent to push fix after fix to the Dependabot branch. Each push starts a full CircleCI pipeline that is attributed to, and emails, whoever owns the pushing token. The skill runs the CI mirror (`bun run prepush`) locally, pushes once per run, never edits CI config to make a bump pass, and stops after two red CI rounds.

`scripts/planning/fingerprintRisk.ts` (`isFingerprintSkip`) is the skip matcher. After every allowed bump the skill still recomputes hashes; a changed hash is reverted even if the matcher allowed the name.

## Cooldown

Non-security npm versions wait **7 days** after publish before a bump (`npm view <name> time`). Most malicious publishes are yanked inside a day. CVE/advisory bumps skip the wait and still need an exercise test and a fingerprint freeze. Dependabot security updates are advisory bumps, so they have no cooldown.

## Fingerprint freeze

Do not bump from this path:

- `expo`, `expo-*`, `react-native`, `react-native-*` except `react-native-web`
- `@react-native/*` and related community native modules
- `@expo/config-plugins`, `@sentry/react-native`, `@shopify/flash-list`, `@shopify/react-native-skia`
- `eas.json` Bun version (it is a fingerprint input)

Those wait for a Terreno release (`release` + `upgrading-expo` skills). Do not use the `fingerprint-acknowledged` label to sneak them through a dependency PR.

JavaScript packages, GitHub Actions, and a few Expo JS-only names may update. Measure hashes for both apps anyway.

## Dependabot configuration

`.github/dependabot.yml` sets `open-pull-requests-limit: 0` on every block. That turns off version-update PRs; security updates ignore the limit and still honor `ignore`. Each block's group uses `applies-to: security-updates`, so fixes arrive grouped:

| Group | Ecosystem |
| --- | --- |
| `github-actions` | `github-actions` at `/` |
| `root` | `bun` at `/` (root catalog and root tools) |
| `backend` | `bun` under api, ai, backends, … |
| `frontend` | `bun` under ui, rtk, demo, apps, … |

Frontend ignores catalog-managed names so those fixes land once, in the root catalog. Root ignores fingerprint-skip names, so a security fix for a native/Expo package never opens a PR; handle it by hand in a release. `dependabot-auto-merge.yml` approves Dependabot PRs and enables squash auto-merge, so a security PR merges when required checks pass. When one fails because the fix needs code changes, fold the bump into the rolling PR ([Update dependencies](../how-to/update-dependencies.md)); never push to the `dependabot/*` branch.

## Daily rolling PR

The skill runs every day against **one trusted** open PR: exact same-repository head `chore/update-dependencies`, base `master`, and `isCrossRepository: false`. The marker `<!-- terreno-update-dependencies -->` and title are display metadata, not trust signals. Forks that copy them are ignored.

A later run merges current master into that branch without rewriting history, retries **Failed** rows, appends **Landed** / **Failed** / **Skipped**, and pushes to the same head. It does not open a second trusted PR while that one is open. After merge, the next day may open the next rolling PR.

Each package is still proven alone (exercise test + fingerprint) before it stays on the branch. Failures are reverted and kept in the PR body so the next day does not rediscover them from scratch.

## Best practices

- One rolling PR; many proven commits on that branch.
- Majors: exercise test + fingerprint freeze; no auto-merge.
- Security: skip cooldown; do not skip tests or fingerprints.
- Verify locally, push once; never change CI config to make a bump pass.
- New feature dependencies belong in that feature's slice, not this maintenance path.

## Related

- [Update dependencies](../how-to/update-dependencies.md)
- [Run tests locally](../how-to/run-tests-locally.md)
- [Install agent skills](../how-to/install-agent-skills.md)
- [Bun catalogs](https://bun.sh/docs/install/catalogs)
