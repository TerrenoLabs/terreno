# Implementation Plan: Move mcp-server doc-sync off the compile path

**Status:** Complete
**Roadmap:** Area=`dx`, Target=`Released`, Impact=`Improvement`  
**Scan goal:** reduce-cold-compile-time ([charter](../scans/reduce-cold-compile-time/charter.md)) — cold `bun run compile` 305s → 214s
**Slice:** mcp-doc-sync-off-compile-path (round 1) — **must land before** `compile-pipeline-dedup`
**Findings:** mcp-doc-sync-on-compile-path (medium, S)
**Effort:** S
**Owner / Reviewer:** @joshgachnang
**Created:** 2026-09-22

## Goal

Take the three doc-sync scripts and the `cp` off mcp-server's `compile` script so a normal
`bun run compile` type-checks only. This removes ~5s of fixed I/O from every cold build and
— critically — eliminates a Bun `cpSync` race in `sync-versioned-docs` that intermittently
fails the full concurrent build (observed 1/3 runs once Slice B raises build concurrency).

## Background

`mcp-server/package.json` `compile` currently is:

```
NODE_OPTIONS=…=8192 bun run sync-ui-docs && …sync-versioned-docs && …sync-package-guidelines && …tsc && cp -r src/docs dist/
```

- `sync-ui-docs`: `cp ../demo/ui-types-documentation.json src/docs/`
- `sync-versioned-docs`: recursively copies `website/versioned_docs/**` → `src/docs/versioned/**` (heaviest; ~5s; `src/docs/versioned` is git-ignored, generated only here)
- `sync-package-guidelines`: copies five packages' `.ai` trees → `src/docs/guidelines/` (`guidelines/` IS committed)
- `cp -r src/docs dist/`: bundles docs next to compiled output

Runtime/`resources.ts` reads `getDocsRoot()/…` = `<dir>/docs`, so the **published** artifact
must bundle docs. `build` already exists and is byte-identical to `compile` (full pipeline).

**Why this blocks Slice B:** with Slice B's dependency-ordered build, ~18 packages compile
concurrently, and `sync-versioned-docs`'s recursive `cpSync` intermittently throws
ENOENT/EEXIST under heavy parallel I/O. It passes 5/5 in isolation; the race only appears
under full-build concurrency. Taking it off `compile` removes the race from `bun run compile`.

## The change (1 file)

`mcp-server/package.json`:
- `compile` → `NODE_OPTIONS=--max-old-space-size=8192 tsc` (type-check only).
- `build` → keep the full pipeline (sync-ui-docs + sync-versioned-docs +
  sync-package-guidelines + tsc + cp), and drop the redundant `NODE_OPTIONS=8192` from the
  three copy steps (keep it only on `tsc`).
- **Add `prepublishOnly": "bun run build"`** so every publish path bundles docs via npm's
  own lifecycle — no per-CI special-casing.

**Why `prepublishOnly` instead of editing a workflow:** the package publishes through **two**
independent CI paths — GitHub Actions (`publish-on-tag.yml`) and CircleCI lockstep
(`scripts/ci/publish-package.sh`) — and both run `bun run compile` (now tsc-only) before
`npm publish`. `npm publish` runs `prepublishOnly` automatically in both, so `bun run build`
regenerates `dist/docs` right before packing regardless of caller. No workflow file is
touched. (`prepublishOnly` fires only on publish — not on install or `npm pack`.)

## Non-goals

- No change to the sync scripts' logic (`sync-versioned-docs.ts`, `sync-package-guidelines.ts`).
- No change to `getDocsRoot` or runtime doc resolution.
- No change to any other package or to `compile-pipeline-dedup` (Slice B).

## Acceptance criteria (observable + verification)

| # | Criterion | Verification |
| --- | --- | --- |
| 1 | `bun run --filter '@terreno/mcp' compile` runs `tsc` only (no sync, no cp) | Inspect build log: zero "Synced docs version", zero `cp` for docs during compile |
| 2 | `bun run build` in mcp-server still produces `dist/docs` with versioned + guidelines + ui-types | `bun run build` then assert `dist/docs/versioned/*`, `dist/docs/guidelines/*`, `dist/docs/ui-types-documentation.json` exist |
| 3 | Published-artifact parity: `bun run build` output matches the pre-change `compile` output | `diff -r` new `build` dist vs a baseline `compile` dist snapshot → no differences |
| 4 | Full cold `bun run compile` no longer runs mcp doc-sync and no longer flakes | Run `bun run compile` from clean 3× → exit 0 each time, zero mcp ENOENT/EEXIST |
| 5 | Every publish path bundles docs | `prepublishOnly` runs `bun run build`; `npm publish --dry-run` shows it firing and regenerating `dist/docs`; both GH Actions and CircleCI `npm publish` trigger it |
| 6 | Lint/type-check green | `bun run --filter '@terreno/mcp' compile` exits 0 |

Criterion #4 is the metric + reliability tie-back.

## Unacceptable trade-offs (charter, verbatim)

- **Published dist output must stay intact** — the published `@terreno/mcp` still ships
  `dist/docs` (versioned + guidelines + ui-types), verified by criteria #2/#3/#5.
- **No type-safety loss.**

## Risks

- **Another consumer relies on `bun run compile` producing mcp `dist/docs`.** Checked: root
  `compile` is dev type-check (no doc need); publish uses `compile`→now `build`; `dev` runs
  from `src` via `bun --watch`. No deploy script runs mcp `compile`→`start`. Residual: local
  `bun run start` after only `compile` would lack freshly-synced versioned docs (already
  git-ignored/generated); run `build` for a runnable server. Documented.

## Docs to update

- `.claude/rules/mcp-server/00-mcp-server.md` / mcp build doc: note `compile` = type-check,
  `build` = shippable artifact with docs.

## Rollout

Single PR, reviewer @joshgachnang, human merge on green CI. Lands before Slice B; Slice B
then rebases on master and its full build is race-free.
