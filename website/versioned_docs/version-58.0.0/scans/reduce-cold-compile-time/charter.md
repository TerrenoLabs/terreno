# Scan charter — reduce cold `bun run compile` wall-clock time

- Slug: reduce-cold-compile-time
- Status: approved (2026-09-20)
- Owner: joshgachnang

## Goal

The terreno monorepo compiles with per-package standalone `tsc` and no build
cache, TS project references, or shared-dep deduplication. A full cold
`bun run compile` currently takes ~305s, and the pipeline recompiles shared
packages (`@terreno/test`, `@terreno/api`, `@terreno/syncdb`, `@terreno/jobs`)
multiple times per run. This campaign cuts cold compile wall-clock by 30% by
removing redundant tsc passes, deduplicating shared-dependency recompiles,
introducing project references, and trimming non-typecheck work from the compile
path — without changing published dist output or weakening type-safety. Faster
compiles shorten every bootstrap, CI run, and agent iteration.

## Metric

| Field | Value |
| --- | --- |
| Name | Cold full-monorepo compile wall-clock |
| Command | `find . -maxdepth 2 -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete; rm -rf */dist; time bun run compile` (min of 3 runs, seconds) |
| Unit | s |
| Direction | down |
| Protocol | Cold (dist + tsbuildinfo removed before each run), best (min) of 3 consecutive runs, same VM |
| Baseline | 305 (measured 2026-09-20) |
| Target | 214 |
| Horizon | 4 rounds |

Baseline evidence:

```text
run1 exit=0 elapsed=321s
run2 exit=0 elapsed=305s
run3 exit=0 elapsed=309s
# best of 3 = 305s ; target -30% = 214s
```

## Scope

- In scope: build/compile configuration only — root `package.json` compile
  scripts, per-package `tsconfig.json` / `tsconfig.server.json`,
  `.github/scripts/compile-workspace-deps.js`, per-package `compile` scripts,
  and any new build tooling that measurably reduces cold compile time.
- Out of scope: product/source logic, test assertions, runtime behavior,
  dependency version bumps unrelated to the build.
- Unacceptable trade-offs:
  - **Published dist output must stay intact** — `declaration` (.d.ts) emit and
    the published `dist/` layout for every `@terreno/*` package are preserved.
  - **No type-safety loss** — no loosening `strict`/`strictNullChecks`, no
    removing existing `skipLibCheck`, no `noEmit`-to-skip-checks tricks. Adding
    `skipLibCheck` where absent is allowed.
  - Publish-time behavior of `compile-workspace-deps.js` must be preserved
    (it exists because tag-publish replaces `workspace:*` refs before install).

New build dependencies ARE permitted (owner did not exclude them), provided the
two guardrails above hold.

## Detection rules

| Rule | Query | Matches | Why it moves the metric | Hits |
| --- | --- | --- | --- | --- |
| redundant-pipeline | Inspect root `compile` script; `grep -rl compile-workspace-deps */package.json` | Root `compile` runs `@terreno/test` and `@terreno/api` explicitly, then `--filter '*'` recompiles them again; `api` and `admin-backend` re-`tsc` shared deps via `compile-workspace-deps.js` | Every duplicate tsc pass of a large package (api=90k LOC, syncdb, test) is pure cold-time waste | 4 |
| no-project-references | For each compile-path tsconfig: `grep -L '"references"'`; check for a root solution tsconfig | 19 tsconfigs compile as isolated `tsc` with no `references`; no root solution tsconfig | Project references (`tsc -b`) compile each package once in dep order and enable parallelism, killing recompile overlap | 19 |
| non-typecheck-work-in-compile | `grep -E 'sync-\|cp \|&&.*&&'` in each package `compile` script | `mcp-server` runs 3 doc-sync scripts at 8GB heap plus a `cp` before/around its `tsc` on every compile | Non-tsc work on the compile critical path adds fixed cold-time cost unrelated to type-checking | 1 |
| missing-skiplibcheck | For each compile-participating tsconfig: `grep '"skipLibCheck"'` | `demo/tsconfig.json` and `website/tsconfig.json` lack `skipLibCheck` (their compile scripts use these configs) | Without `skipLibCheck`, tsc type-checks every `.d.ts` in the dependency tree — costly for RN/Expo/docs dep trees | 2 |

## Exclusions

Beyond the map-reduce defaults: `node_modules/`, `*/dist/`, `patches/`,
`terraform/`, generated files (`openApiSdk.ts`, `plugins/terreno-claude/`), and
`example-frontend` (no `compile` script — not on the compile path).

## Validity rule

A finding is valid only when applying it measurably reduces cold `bun run compile`
wall-clock (best-of-3) while keeping published dist output identical and
type-safety unchanged.

## Severity rubric

| Severity | Threshold |
| --- | --- |
| high | Plausibly removes ≥30s of cold compile time |
| medium | Plausibly removes 5–30s |
| low | Plausibly removes <5s |

Effort: S = under an hour, M = under a day, L = more than a day or needs design.

## Slice policy

- Maximum 4 files and 3 findings per slice.
- Never mix: a project-references migration with unrelated tsconfig flag tweaks;
  or `compile-workspace-deps.js` changes with anything else.
- Always its own slice: the `tsc -b` / project-references migration (touches
  every package + CI; reviewer-heavy) and any `compile-workspace-deps.js`
  change (publish-time behavior risk).

## Review routing

| Field | Value |
| --- | --- |
| Mode | fixed |
| Reviewers | @joshgachnang |
| Assignee | @joshgachnang |
| Teams | — |
| Draft | no |
| Labels | reduce-cold-compile-time, build-perf |
| Merge policy | human |
| Notify | PR body mention |

## Budget

- Rounds: 4
- Slices per round: 2
- Open PRs at once (`wipLimit`): 1
- Minimum metric step per round before reporting diminishing returns: 10s

## Decisions

| Decision | Question that prompted it |
| --- | --- |
| Goal = reduce cold `bun run compile` wall-clock | "What goal should this scan campaign drive toward?" |
| Target = 214s (−30% of 305s baseline) | "How aggressive a cold-compile reduction should this campaign target?" |
| Guardrails = keep published dist output + no type-safety loss; new build deps allowed | "What must this campaign NOT break while cutting compile time?" |
| Review = fixed @joshgachnang, human merge | "Who reviews the campaign's PRs, and what's the merge policy?" |
| Budget = 1 open PR, 2 slices/round, 4 rounds | "How much work-in-progress should the campaign carry per round?" |
