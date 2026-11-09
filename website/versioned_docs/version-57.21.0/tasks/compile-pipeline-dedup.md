# Tasks: Compile pipeline dedup

IP: [compile-pipeline-dedup.md](../implementationPlans/compile-pipeline-dedup.md)
Slice: pipeline-ordering-dedup · Scan goal: reduce-cold-compile-time (305s → 214s)

Tracer-bullet order. Each task names files, acceptance, and verification.

## T0 — Capture baseline artifacts (blocking, no code change)

- **Files:** none (read-only).
- **Do:** `rm -rf */dist && bun run compile 2>&1 | tee /tmp/baseline-build.log`; copy every
  package's `dist/` into a baseline snapshot dir for later `diff -r`.
- **Acceptance:** baseline build log + dist snapshot captured; note the cold time (best of
  3 already recorded = 305s).
- **Verify:** snapshot dir exists with per-package `dist/`.

## T1 — Apply the three compile-script edits

- **Files:** `package.json`, `api/package.json`, `admin-backend/package.json`.
- **Do:**
  - root `compile` → `bun run --filter '*' compile`
  - `api` `compile` → `bun tsc`
  - `admin-backend` `compile` → `bun tsc`
- **Acceptance:** the three scripts match the IP; `.github/scripts/compile-workspace-deps.js`
  is untouched (`git diff --stat` excludes it).
- **Blockers:** none. **Docs:** none yet.

## T2 — Prove correctness: single-build, clean, dist-identical

- **Files:** none (verification).
- **Do:** `rm -rf */dist && bun run compile 2>&1 | tee /tmp/new-build.log`; then
  `diff -r` each package's new `dist/` against the T0 snapshot.
- **Acceptance (IP criteria 1–3):**
  - exit 0 from clean tree
  - each buildable `@terreno/*` package appears once; **zero** `Compiling @terreno/... with
    bun tsc` lines (that string only comes from `compile-workspace-deps.js`, which must not
    run during the dev build)
  - `diff -r` reports no differences in any `dist/`
- **Verify:** grep `/tmp/new-build.log` for per-package compile count and for
  `compile-workspace-deps` output (expect none).

## T3 — Prove publish/CI unaffected

- **Files:** none (verification).
- **Do:** confirm `compile-workspace-deps.js` unchanged; re-read each caller
  (`publish-on-tag.yml`, `.circleci/continue-config.yml`, `new-file-coverage.yml`,
  `rtk-ci.yml`, `example-*-ci.yml`, `scripts/ci/*.sh`) and confirm each still calls the
  script directly before its compile step.
- **Acceptance (IP criterion 5):** every publish/CI compile is preceded by a direct
  `compile-workspace-deps.js` call; script content unchanged.

## T4 — Measure + docs

- **Files:** build/compile explanation doc (if the root `compile` contract is documented).
- **Do:** run the metric command best-of-3
  (`find . -maxdepth 2 -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete; rm -rf */dist; time bun run compile`);
  record min. Update the build doc to note reliance on Bun topological ordering (via
  `update-docs` skill).
- **Acceptance (IP criteria 4, 6):** cold time recorded with delta vs 305s; `bun run lint`,
  `bun run api:test`, `bun run ui:test` green.
- **Verify:** three timings recorded; lint/test exit 0.
