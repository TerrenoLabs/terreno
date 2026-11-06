# Tasks: Move mcp-server doc-sync off the compile path

IP: [mcp-doc-sync-off-compile-path.md](../implementationPlans/mcp-doc-sync-off-compile-path.md)
Slice: mcp-doc-sync-off-compile-path · Scan goal: reduce-cold-compile-time (305s → 214s)

## T0 — Baseline snapshot (done)

- Built current mcp `compile` (full pipeline) and snapshotted `dist/docs`
  (3224 versioned + 6 guidelines + ui-types) for parity diff.

## T1 — Split compile/build + bundle docs at publish (done)

- `mcp-server/package.json`: `compile` → `NODE_OPTIONS=--max-old-space-size=8192 tsc`;
  `build` keeps sync+tsc+cp, redundant `NODE_OPTIONS` dropped from the copy steps.
- Added `prepublishOnly: "bun run build"` so **both** publish paths (GitHub Actions and
  CircleCI `scripts/ci/publish-package.sh`) bundle docs via npm's lifecycle. No workflow
  edit needed. (Fixes Bugbot: CircleCI publish also runs the tsc-only `compile`.)

## T2 — Verify (done)

- mcp `compile`: tsc only, 0 "Synced docs" lines, no `dist/docs`, `dist/index.js` present. ✅
- mcp `build`: `dist/docs` byte-identical to baseline (`diff -r` → IDENTICAL). ✅
- Combined A+B integration (B stacked temporarily): full `bun run compile` ×3 →
  exit 0, 0 errors, 0 mcp sync during compile. Best cold **186s vs 305s baseline (−39%)**. ✅
- publish-mcp job runs `bun run build`. ✅

## T3 — Docs (done)

- Updated `.claude/rules/mcp-server/00-mcp-server.md`: `compile` = type-check,
  `build` = shippable artifact with docs.
