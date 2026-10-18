# Implementation Plan: Remove the Knip baseline

**Status:** Complete  
**Roadmap:** Area=`dx`, Target=`Released`, Impact=`Improvement`  
**Created:** 2026-09-09  
**Owner:** unassigned  
**Primary packages:** repo-wide (`knip.jsonc`, `scripts/static-analysis/`, every workspace Knip currently fingerprints)  
**RTK deprecation flag:** None

## Goal

`bun run analyze:full` stays green and Knip has no baseline file. Every finding that existed on 2026-09-08 (~1076 fingerprints: 529 default + 547 production) is either **gone from the live Knip report** (fixed) or **declared in `knip.jsonc` with a one-line reason** (disabled).

Inventory snapshot (do not treat as the live list — Pick re-runs Knip):

| Class | Default count (approx.) | Typical cause |
| --- | --- | --- |
| unused files | 123 | missing entries (`*.isolated.*`, `scripts/**/*.test.ts`, mcp tests, generated skill copies) |
| unused exports / types | 212 / 81 | internals still `export`ed; scripts libs not in graph; public API unused in-monorepo |
| unused dependencies | 62 | Expo autolink / Metro peers Knip cannot see; a few true leftovers |
| unused devDependencies | 34 | `sinon`, codegen CLIs, types for removed libs |
| unlisted | 13 | `expo-system-ui` in `app.json`, `jspdf` in metro stubs, optional `ioredis` |
| binaries / catalog / optional peers | 5 | `eas`, `maestro`, catalog `@sentry/react-native` |

## Non-Goals

- Shrinking published `@terreno/*` public APIs (package `index` re-exports stay).
- Deleting Expo native, autolink, or Metro packages because Knip cannot see them.
- Running `knip --fix`.
- Changing dependency-cruiser rules except regenerating its baseline if a deleted file is listed there.
- Rewriting Biome or hook wiring.

## Decisions

| Question | Decision |
|----------|----------|
| Knip baseline when done? | None. Survivors live only in `knip.jsonc`. |
| Unused published exports | Unexport or delete symbols **not** on the public package entry. Ignore leftover public API in `knip.jsonc`. |
| Expo / native `dependencies` Knip cannot see | `ignoreDependencies` / ignore globs with a reason. Do not remove from `package.json`. |
| Dead in-repo app/demo code | Delete or stop exporting when nothing in-repo uses it. Keep (then ignore as an entry) only what docs, E2E, or codegen still invoke. |
| Shape | One IP. Tasks by finding class, not one IP per package. |

## Architecture

Knip has an incomplete **entry graph**. Most “unused files” are tests, isolated suites, Metro stubs, codegen configs, and generated skill copies that are never imported. Fix the graph first so later delete/unexport work is not guessing.

```
knip.jsonc
  entries     → isolated tests, scripts tests, e2e, codegen, stubs
  ignore*     → Expo autolink, binaries, public API leftovers
code          → delete dead files; unexport internal unused symbols
check:knip    → fail on any finding not handled above
```

### Disposition rules (Pick must apply in this order)

1. **Entry** — file is executed by Bun/Playwright/Expo/codegen/CI but Knip does not see it. Add `entry` / plugin / workspace config. Do not delete.
2. **Ignore** — tool-blind (autolink, `app.json` plugins, optional native peers) **or** published public API unused in this monorepo. Add `ignore` / `ignoreDependencies` / `ignoreBinaries` / `ignoreIssues` with a comment naming the reason. Do not delete Expo native deps.
3. **Unexport** — symbol is `export`ed from an internal module and is not on the package public entry. Drop `export` or move to a non-exported binding.
4. **Delete** — file or dependency unused after (1)–(3), including in-repo-dead example/demo hooks and leftover `devDependencies` such as `sinon` once the graph is honest.

Never use `knip --fix`. Delete the old JSON baseline only after the live report is empty.

### Public vs internal export

A symbol is **public** if a published package `src/index.ts` / `src/index.tsx` (or documented extra export path in that package’s `package.json` `exports`) re-exports it. All other unused exports are **internal**.

### Expo / Metro ignore set (starting list; Pick verifies)

Apps (`demo`, `admin-spa`, `example-frontend`) and `ui` declare packages for autolinking, fonts, haptics, pickers, Skia, Metro polyfills (`crypto-browserify`, `stream-browserify`), and `jspdf` stubs. `app.json` / `app.config.ts` name `expo-system-ui` (and similar) without a JS import. Those stay in `package.json` and are ignored in Knip.

## Models

None.

## APIs

None. Operator surface is `knip.jsonc`, `bun run check:knip`, and `bun run analyze:full`.

## Notifications

None.

## UI

None. Example-frontend / demo file deletes must not remove screens still routed or documented. Frontend verification applies only to tasks that delete or unwire UI modules: launch the affected app, exercise the related screen, save artifacts.

## Phases

| Phase | Outcome |
| --- | --- |
| 1 Entry graph | Isolated tests, `scripts/**/*.test.ts`, mcp tests, e2e, codegen, Metro stubs, generated skill script copies are entries or ignored globs. Unused-file count drops sharply. |
| 2 Documented ignores | Expo/autolink deps, binaries (`eas`, `maestro`), unlisted `app.json` plugins, catalog-only packages. |
| 3 True unused packages | Remove `devDependencies` / dependencies that are unused after the graph is honest (`sinon`, stale `@types/*`, etc.). |
| 4 Dead files | Delete in-repo-dead modules (example hooks, unused stories, unused scripts). |
| 5 Internal exports | Unexport unused internals. Ignore remaining public unused exports/types. |
| 6 Contract | Live Knip report empty. Delete the baseline. Rewrite the enforcement docs. |

Keep the existing fat baseline until Phase 6, then delete it once the live report is empty.

## Feature Flags & Migrations

None.

## Activity Log & User Updates

None.

## Not Included / Future Work

- Teaching Knip Expo autolinking for real (upstream / custom compiler).
- Publishing previously unused public exports with in-repo callers (out of scope; ignore is enough).

## Files to Create / Modify

| File | Role |
| --- | --- |
| `knip.jsonc` | Entries, ignores, workspace plugin fixes |
| `scripts/static-analysis/knip-baseline.json` | Delete after reaching zero findings |
| `scripts/static-analysis/full.ts` / `lib.test.ts` | Enforce zero findings directly |
| `docs/explanation/static-analysis.md` | Policy: no Knip baseline; ignore vs delete |
| Package `package.json` files | Remove true unused deps only |
| Dead source files listed by live Knip after Phase 1 | Delete or unexport |

## Task List

[`docs/tasks/knip-cleanup.md`](../tasks/knip-cleanup.md)

## Acceptance Criteria

- [ ] `bun run analyze:full` exits 0.
- [ ] `scripts/static-analysis/knip-baseline.json` does not exist.
- [ ] Every `ignore` / `ignoreDependencies` / `ignoreBinaries` / `ignoreIssues` entry in `knip.jsonc` has a comment stating why it cannot be a code fix.
- [ ] No published `@terreno/*` `index` export was removed.
- [ ] No Expo autolink/native package was removed from an app or `ui` `package.json` solely because Knip flagged it.
- [ ] `docs/explanation/static-analysis.md` describes the no-baseline policy and forbids `knip --fix`.
- [ ] `bun test scripts/static-analysis/lib.test.ts` still passes.
