# Implementation Plan: Compile pipeline dedup (remove redundant recompiles)

**Status:** Complete — shipped in #1360
**Roadmap:** Area=`dx`, Target=`Released`, Impact=`Improvement`  
**Scan goal:** reduce-cold-compile-time ([charter](../scans/reduce-cold-compile-time/charter.md)) — cold `bun run compile` 305s → 214s
**Slice:** pipeline-ordering-dedup (round 1, top slice)
**Findings:** redundant-explicit-prefix (high, S), compile-workspace-deps-overlap (high, M)
**Effort:** S–M
**Owner / Reviewer:** @joshgachnang
**Created:** 2026-09-21

## Goal

Make each `@terreno/*` package compile **exactly once** per cold `bun run compile` by
relying on Bun's built-in workspace dependency ordering, instead of the current pipeline
that recompiles shared packages many times. Target contribution to the scan goal: ~60–90s.

## Background — measured redundancy

Baseline cold `bun run compile` = 305s. The root script is:

```
"compile": "bun run --filter '@terreno/test' compile && bun run --filter '@terreno/api' compile && bun run --filter '*' compile"
```

From the baseline build log, per full run:

| Package | Times compiled | Should be | Isolated cost |
| --- | --- | --- | --- |
| @terreno/test | ~5× | 1× | 10s |
| @terreno/syncdb | ~4× | 1× | ~9s |
| @terreno/api | ~3× | 1× | 31s (tsc), 50s (with deps) |
| @terreno/jobs | ~2× | 1× | ~8s |

Two causes:
1. **redundant-explicit-prefix** (`package.json:223`): the explicit `@terreno/test` and
   `@terreno/api` prefixes duplicate the `--filter '*'` pass, which already builds all 19
   workspaces.
2. **compile-workspace-deps-overlap** (`api/package.json:117`, `admin-backend/package.json:47`):
   both packages prefix their `compile` with `node ../.github/scripts/compile-workspace-deps.js`,
   which re-`tsc`s their `@terreno/*` deps in every process (its dedupe `Set` does not
   persist across `bun run` processes), while `--filter '*'` also builds those same deps.

## Key research finding — Bun orders builds topologically

Bun 1.4.2 `bun run --filter '*' <script>` executes scripts in **workspace dependency
order** (a dependent waits for its dependencies' script to finish). Evidence from the
baseline log: `@terreno/rtk` (→ `ui`, plain `tsc`, `ui` is **not** prebuilt by the
explicit prefixes) finishes after `ui`; `jobs`/`ai`/`comms` (→ `api`) finish after `api`;
`example-backend` (→ 9 packages) finishes last. Because these plain-`tsc` packages resolve
their `@terreno/*` deps from `dist/` (no `paths` → src) and the build succeeds, Bun must be
ordering deps first.

Dependency graph (acyclic): test, syncdb, ui → (leaves); api → test,syncdb; jobs/ai/comms/
feature-flags → api,test; rtk → ui; admin-frontend → ui; admin-backend → api,jobs,test;
example-backend → (many).

## The change (4 files)

The redundancy exists because the pipeline recompiles shared deps to guarantee ordering.
Bun's `--filter '*'` already builds in dependency order, so in the **root** build the
per-package `compile-workspace-deps.js` work is pure duplication. But **isolated** compiles
(`cd <pkg> && bun run compile` in CircleCI per-package jobs and tag publish) have no
`--filter '*'` ordering and genuinely need it. So we gate it by context rather than remove
it:

1. `package.json` root `compile` → `TERRENO_SKIP_WORKSPACE_DEPS=1 bun run --filter '*' compile`
   (drop the two explicit `@terreno/test` + `@terreno/api` prefixes; set the skip flag).
2. `.github/scripts/compile-workspace-deps.js` → early-return when
   `TERRENO_SKIP_WORKSPACE_DEPS` is set. The flag is inherited by every `--filter '*'`
   subprocess, so `api`/`admin-backend` skip the redundant dep rebuild while Bun's ordering
   supplies the dists. Isolated compiles (no flag) build deps exactly as before.
3. `api/package.json` `compile` — **unchanged** (`compile-workspace-deps.js && bun tsc`).
4. `admin-backend/package.json` `compile` — **unchanged**.

(Net: files 3–4 are unchanged vs master; the working change is files 1–2.)

## Non-goals

- No TS project references / `tsc -b` (that is the deferred `no-project-references`
  finding — an alternative road to the same ordering goal; a separate slice/round).
- No mcp-server doc-sync change (Slice A, already merged as #1358).
- No `tsconfig` changes, no `skipLibCheck` changes, no strictness changes.

## Why publish/CI stay green

Isolated per-package compiles do **not** set `TERRENO_SKIP_WORKSPACE_DEPS`, so
`compile-workspace-deps.js` runs normally and builds sibling dists from source — exactly
as on master. This covers CircleCI per-package jobs (`api-ci`, `compile_packages`, …), the
`publish-on-tag.yml` steps, and `scripts/ci/publish-package.sh`. Verified: `cd api &&
bun run compile` with a clean tree builds `@terreno/test` + `@terreno/syncdb` then `api`
(exit 0). Only the root ordered build skips the redundant recompile.

## Acceptance criteria (observable + verification)

| # | Criterion | Verification |
| --- | --- | --- |
| 1 | Cold `bun run compile` exits 0 from a clean tree | `rm -rf */dist && bun run compile; echo $?` → 0 |
| 2 | Each `@terreno/*` package is `tsc`-built exactly once per run | Capture build log; assert one "compile: Exited" per buildable package and zero `Compiling @terreno/... with bun tsc` lines from `compile-workspace-deps` during the dev build |
| 3 | Published `dist/` is byte-identical to baseline | Build baseline dist → tmpA; build new dist → tmpB; `diff -r` every package's `dist/` → no differences |
| 4 | Cold compile time drops materially | Metric command best-of-3; record min vs 305s baseline (expect ~60–90s reduction) |
| 5 | Publish path unaffected | `git diff --stat` shows `compile-workspace-deps.js` unchanged; confirm each CI/publish job still calls it directly before its compile |
| 6 | Lint + tests green | `bun run lint`, `bun run api:test`, `bun run ui:test` pass |

Criterion #4 is the metric tie-back.

## Unacceptable trade-offs (charter, verbatim)

- **Published dist output must stay intact** — `declaration` (.d.ts) emit and the published
  `dist/` layout for every `@terreno/*` package are preserved.
- **No type-safety loss** — no loosening `strict`/`strictNullChecks`, no removing existing
  `skipLibCheck`.
- Publish-time behavior of `compile-workspace-deps.js` must be preserved.

## Risks

- **Bun ordering not guaranteed for some edge package.** Mitigated by criterion #1 (clean
  full build) and #3 (dist parity). If a specific package fails ordering, fall back to an
  explicit dependency-ordered filter for that package only — not a return to full-pass
  duplication.
- **A hidden consumer relies on `bun run --filter '@terreno/api' compile` self-building
  deps.** Checked: all CI/publish callers invoke the script directly first (criterion #5).

## Docs to update

- Build/compile explanation doc (if the root `compile` contract is documented) via the
  `update-docs` skill.
- One-line comment in root `package.json`? (json → not possible) — instead note the
  ordering reliance in the build doc.

## Rollout

Single PR, reviewer @joshgachnang, human merge on green CI. No feature flag; revertable by
restoring the three script strings.
