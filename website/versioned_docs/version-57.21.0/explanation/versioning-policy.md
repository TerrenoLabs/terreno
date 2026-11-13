# Versioning policy

All published `@terreno/*` packages share one version. Upgrade them together. Mixing versions is unsupported.

## Lockstep

A git tag `X.Y.Z` (no `v` prefix) is the version for every package that `.github/workflows/publish-on-tag.yml` publishes: `api`, `test`, `ui`, `rtk`, `admin-backend`, `admin-frontend`, `admin-spa`, `blocks`, `ai`, `api-health`, `comms`, `feature-flags`, `mcp`, `syncdb`. Publish jobs read that tag; they do not pick per-package versions.

Inside the monorepo, packages depend on each other with `workspace:*` (for example `@terreno/rtk` → `@terreno/ui`). On npm they are released at the same number. `@terreno/ui` also pins Expo-line peers (`react-native` `~0.86.0` on the 57 line). Installing `@terreno/ui@57` next to Expo 54 is outside support, same as mixing `@terreno/api@57` with `@terreno/ui@0.31`.

## Pre-1.0 (and Expo-aligned majors)

While the public API is still moving, a **minor** may include breaking changes. Those land only with an upgrade note in `mcp-server/src/docs/upgrades/<version>.md`. The changelog `### Breaking` / `### Changed` / `### Deprecated` / `### Removed` headings require that file (`bun run check:upgrade-docs`).

From 56 onward the **major** tracks the Expo SDK major (`56.x`, `57.x`). That is not a 1.0 stability promise. It is a peer-stack label.

## Deprecation window

A public API marked deprecated stays available for **at least three minor releases** on the current major (example: deprecated in `57.1.0` → still present in `57.2.0` and `57.3.0`). Removal happens in a later minor or the next major, always with an upgrade note.

Worked example: `@terreno/rtk` collection CRUD was deprecated in `56.0.0` (restated in `57.1.0`). The package still publishes on 57.x for the OpenAPI SDK, Better Auth Redux, feature flags, and sockets. It will not ship in the **next major**. Migrate collection screens with [migrate-rtk-to-syncdb.md](../how-to/migrate-rtk-to-syncdb.md) as a separate operation from a routine version bump.

## Where to read changes

| Source | Use |
| --- | --- |
| [`CHANGELOG.md`](../../CHANGELOG.md) | What shipped |
| [`mcp-server/src/docs/upgrades/`](../../mcp-server/src/docs/upgrades/) | What you must do |
| MCP `terreno_get_upgrade_guide` | Concatenated notes for `fromVersion` → `toVersion` |

Note format: [`mcp-server/src/docs/upgrades/README.md`](../../mcp-server/src/docs/upgrades/README.md).

## What 1.0 will mean

OSS launch question P9 ([oss-launch-program.md](../implementationPlans/oss-launch-program.md)): 1.0 is an API-stability audit after syncdb has settled — not the Expo-aligned 57 line. Until that audit, treat minors as able to break with a note.
