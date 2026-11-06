# Round 1 findings — reduce cold `bun run compile` time

- Goal: reduce cold `bun run compile` wall-clock across the terreno monorepo
- Metric: cold compile seconds (best of 3). **Baseline 305s → target 214s (−30%)**
- Head: `f8779a96`
- Kept: 4 findings · Merged: 2 candidates · Dropped: 2 candidates

## Measured evidence (Sift verification)

| Measurement | Result |
| --- | --- |
| `@terreno/test` compile (cold) | 10s |
| `@terreno/api` compile FULL (compile-workspace-deps + tsc, cold) | 50s |
| `@terreno/api` tsc-only (deps prebuilt) | 31s → compile-workspace-deps adds **~19s per api compile** |
| demo `tsc --noEmit` without vs with `--skipLibCheck` | 10s vs 10s → **0s** delta |
| mcp-server sync scripts (sync-ui / sync-versioned / sync-package) | 0s + 5s + 0s = **~5s** |

## Ranked findings

| # | ID | Rule | Sev | Conf | Effort | Est. cold-time saving | Anchors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | redundant-explicit-prefix | redundant-pipeline | high | high | S* | ~60s (1× test + 1× api) | `package.json:223` |
| 2 | compile-workspace-deps-overlap | redundant-pipeline | high | high | M | ~19s+ per api compile, ×2–3 dependents | `.github/scripts/compile-workspace-deps.js:22`, `api/package.json:117`, `admin-backend/package.json:47` |
| 3 | no-project-references | no-project-references | high | medium | L | large but unquantified; durable fix that enables #1/#2 safely | `api/tsconfig.json:1` + 18 more; no root solution tsconfig |
| 4 | mcp-doc-sync-on-compile-path | non-typecheck-work-in-compile | medium | high | S | ~5s | `mcp-server/package.json:52` |

\* #1 is a one-line edit but is **load-bearing for build ordering** — safe only once #2/#3 provide dependency-ordered builds. See coupling note below.

## High-severity findings (adversarial verification)

### 1. Redundant explicit `test`+`api` prefixes in root compile — CONFIRMED
Root `compile` = `bun run --filter '@terreno/test' compile && bun run --filter '@terreno/api' compile && bun run --filter '*' compile`. The final `--filter '*'` already builds all 19 workspaces including `test` and `api`, so the two prefixes are a full extra cold compile of test (10s) + api (50s) = **~60s of duplication**.

*Refutation attempted:* "The prefixes force build order; removing them breaks `*`." → Partially holds. `compile-workspace-deps.js` makes api self-build its deps, so api compiles fine inside `*`; but bun `--filter '*'` gives no guaranteed dependency order, so the prefixes currently serve as a crude ordering hack. Verdict: the **duplication is real and confirmed**, but the safe fix is to introduce real ordering (#2/#3), not to blindly delete the prefixes. Kept high.

### 2. compile-workspace-deps.js re-tsc's shared deps every compile — CONFIRMED
`compile-workspace-deps.js:22` (`const compiled = new Set()`) dedupes only within one node process. Each package's compile runs in its own `bun run` process, so api re-builds test+syncdb (+19s measured over tsc-only), and admin-backend re-builds api (~50s!)+jobs+test — while `--filter '*'` also builds those same packages as their own targets. Shared deps are cold-compiled multiple times per run.

*Refutation attempted:* "The script is required so deps' `dist` exists before dependents compile." → Holds for the current unordered `*` build, and the script's own doc comment says it exists for tag-publish (post-`workspace:*`-replacement installs). Verdict: confirmed redundant **for the dev/monorepo build**; the fix must preserve publish-time behavior (charter guardrail) and supply ordering another way. Kept high, effort M.

### 3. No TS project references / `tsc -b` solution build — CONFIRMED
No package tsconfig has `references` or `composite`, and there is no root solution tsconfig (`grep -c '"composite"'` → 0 everywhere; `ls tsconfig.json` → not found). Every package is a full standalone `tsc`.

*Refutation attempted:* "Project references help warm builds (via .tsbuildinfo reuse), not cold — this campaign measures cold." → Fails: even cold, `tsc -b` walks the reference graph and compiles each package **exactly once** in dependency order and parallelizes independent leaves, eliminating the multi-recompile waste that #1 and #2 describe. It is the durable structural fix that makes #1 and #2 safe. Verdict: confirmed high; magnitude unproven without doing the migration → confidence medium, effort L.

## Coupling note (for Plot)

Findings #1, #2, #3 are one problem at three depths: the pipeline recompiles shared packages because there is no dependency-ordered build. #3 (project references) is the durable fix and would subsume #1/#2. A lighter interim fix is bun topological filter ordering. Per charter slice policy: the project-references migration and any `compile-workspace-deps.js` change each get **their own slice**. Finding #4 is fully independent and is the cheapest standalone win.

## Merged candidates

- `s1-pipeline-3` ("test compiled 3×") — folded into #1 and #2; it is the same duplication counted from test's side.
- `s3-mcpwork-2` ("8GB heap flag on copy scripts") — folded into #4; negligible sub-part of the same compile string.

## Dropped candidates

| Candidate | Reason |
| --- | --- |
| `s4-skiplibcheck-1` (demo) | **Invalid — refuted.** `skipLibCheck` is already inherited from `expo/tsconfig.base` (`skipLibCheck: true`). Measured delta 10s vs 10s = 0s. No metric movement. |
| `s4-skiplibcheck-2` (website) | **Invalid — refuted.** `skipLibCheck` already inherited from `@docusaurus/tsconfig` (`skipLibCheck: true`). `--noEmit` + tiny source set → no measurable movement. |

Drop reasons: 2/2 = already-satisfied-via-inheritance / no-metric-movement.
