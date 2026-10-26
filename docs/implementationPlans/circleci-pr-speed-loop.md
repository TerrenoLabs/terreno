# Implementation Plan: CircleCI PR Speed Loop

**Status:** In progress — iteration 0 (instrumentation) in review; iteration 1 picks the first lever
**Owner:** Josh
**Goal:** cut CircleCI wall-clock time for an **average PR** by **40% (≤ 5.7 min)**
or to **under 4 min**, whichever comes first, without weakening any gate.
**Driver:** run as a long-lived loop. `/terreno-scan:loop` with this document as
the charter fits. Each iteration ships one PR-sized change through Pick → Roast →
Brew → Taste.

## Metric

**PR CI wall clock:** from the first `ci/circleci:` status on a PR's head commit
to the last terminal status of a test or build job. Excluded from the end time:
`approve`, `architectural-pr-review`, `dco`, `deploy-*` previews, and
`serial-*` deploy-group statuses. Those are review bots and previews, not tests.

**Average PR:** a merged PR that touches **≤ 3 top-level directories**, not
counting `docs/`, `website/`, or dot-directories (so `changelog/` counts).
44 of the last 60 merged PRs qualify, and the median PR touches 2. PRs touching more than 3
directories are tracked but do not count toward the goal.

**Reported value:** the median over the last 20 qualifying merged PRs, plus the
median of the benchmark set (below) for each experiment.

### Baseline (last 60 merged PRs, measured 2026-10-25)

| | Median | p25 | p75 |
|---|---|---|---|
| Average PRs (≤ 3 directories, n = 44) | **9.5 min** | — | — |
| All PRs (n = 60) | 10.3 min | 5.9 min | 12.1 min |

**Target:** median ≤ **5.7 min** (40% faster). If it gets there, keep going
toward **≤ 4.0 min** only while iterations still pay off (see stop rules).

Job that finished last on average PRs:

| Job | PRs where it was last | Median duration | Median start after pipeline start |
|---|---|---|---|
| `e2e-app` | 13 / 44 | 4.0 min | 6.3 min (waits on `e2e-prepare`, 5.4 min) |
| `api-ci` | 10 / 44 | 10.8 min | 1.0 min |
| `repo-policies` | 5 / 44 | — | — |
| `mcp-server-docker` | 4 / 44 | — | — |
| `maestro-e2e` | 3 / 44 | 8.9 min | 0.9 min |
| `new-file-coverage` | 3 / 44 | 3.5 min | 0.5 min |

Other long jobs that can become last once these shrink:

| Job | Median duration |
|---|---|
| `example-backend-docker` | 7.6 min |
| `admin-spa-integration` | 6.0 min |
| `ai-ci` | 5.9 min |
| `admin-spa-ci` | 4.9 min |
| `example-backend-ci` | 4.3 min |

The setup workflow (path filtering plus continuation) costs about 0.6–1.0 min
before any job starts. The 4-minute target needs that cut too.

## Guardrails

The loop may change anything in CI: config, resource classes, caching,
parallelism, job graph, test runners, and test code. It may **not**:

1. Delete, skip, or `.skip` a test. The one exception is a selection mechanism
   (TIA, path filtering, the e2e affected gate) whose shadow run proves zero
   misses over at least 2 weeks.
2. Lower a coverage threshold, or move a blocking gate to post-merge. That
   covers the 95% package gate, the 90% new-file gate, Knip zero findings, the
   dependency-cruiser baseline, lint, and typecheck.
3. Mark a flaky test as allowed-to-fail. Fix it or quarantine it with a
   tracking issue, and count the quarantine as a regression for this goal.
4. Make `master` or release pipelines less safe. `master` still runs
   everything.
5. Raise CircleCI spend more than **25%** per average PR without Josh's
   approval. Report credits per average PR in every iteration.

## The loop

Each iteration is one PR. Keep going until a stop rule fires.

1. **Measure.** Run `bun run ci:wall-clock --limit 20` for the rolling median
   and the last-job histogram. Pull per-job step timings from
   the CircleCI API (`CIRCLECI_TOKEN`; slug in `docs/how-to/circleci.md`) for
   the top 2 critical-path jobs.
2. **Pick the lever.** Take the job that is most often last. Choose the
   highest-expected-gain lever for it from the backlog, or a new one found in
   step 1. Write the hypothesis in the ledger, e.g. "caching the `bun install`
   store cuts `api-ci` by 50 s".
3. **Build it** on `ci-speed/<n>-<slug>` with Pick → Roast. Config changes
   need `scripts/check-circleci-parity` and `circleci config validate` to pass.
4. **Benchmark.** Run the [benchmark set](#benchmark-set) against the branch
   and against `master` in the same hour, 2 runs each. The result is the
   median of each case's median.
5. **Decide.**
   - **Keep:** benchmark median improves by **≥ 5%** (≈ 30 s) with every
     guardrail intact. Brew → Taste → merge.
   - **Drop:** under 5%, or any guardrail broken. Record why in the ledger and
     close the PR.
6. **Re-measure** after merge on the next 20 qualifying real PRs. Update the
   ledger and the baseline table.
7. **Loop.**

### Stop rules

- **Done:** the rolling real-PR median is ≤ 5.7 min (or ≤ 4.0 min) for 20
  qualifying PRs in a row. Post a final report.
- **Stalled:** 3 iterations in a row each gain under 5%. Escalate to Josh with
  the current critical path, the levers tried, and the next options with their
  cost (e.g. bigger resource classes, a paid feature, dropping a job from PRs
  with proof).
- **Blocked:** a lever needs a guardrail exception or a spend increase over
  25%. Ask Josh.

### Benchmark set

Five recent average PRs whose code still reverts cleanly on `master`. They
cover the jobs that most often finish last (`api-ci` and the e2e chain). Refresh
them with `bun run ci:bench --suggest-cases` every 10 iterations, or sooner when
a case replays as `invalid`.

| Case | Shape | PR |
|---|---|---|
| `api-only` | `api` feature (plus changelog and docs) | #1491 |
| `api-syncdb` | `api` plus `syncdb` | #1555 |
| `ui-only` | `ui` component fix | #1567 |
| `admin-example` | `admin-frontend` plus `example-frontend` | #1540 |
| `small-package` | `create-terreno-app` | #1599 |

Mechanics: `bun run ci:bench --branch <branch> --label <iteration>` (see
[benchmark a CI change](../how-to/circleci.md#benchmark-a-ci-change)). For each
case it opens two draft PRs labelled `ci-bench`, waits for CircleCI to settle,
records the metric, and closes both PRs:

- **Control:** `master` with the case's code hunks reverted.
- **Treatment:** the branch under test with the case's code hunks reverted.

The case list lives in `scripts/ci/bench/cases.ts`.

### Ledger

Append one row per iteration. Never edit past rows.

| # | Date | Lever | Target job | Bench before → after | Real-PR median after | Credits/avg PR | Kept? | PR |
|---|---|---|---|---|---|---|---|---|
| 0 | 2026-10-25 | Baseline | — | — | 9.5 min | TBD | — | — |
| 0 | 2026-10-26 | Instrumentation (`ci:wall-clock`, `ci:bench`) | — | `api-only` on master: 11.6 min (1 run, last job `api-ci`) | 9.5 min | TBD (needs CircleCI token) | Yes | this PR |

## Lever backlog

The order is a starting point. Re-rank every iteration from fresh step
timings.

### Iteration 0 — Instrumentation (½ day, required first)

- Add `bun run ci:wall-clock` (`scripts/ci/ciWallClock/`), with tests, from
  the measurement used for the baseline above.
- Add `bun run ci:bench` (`scripts/ci/bench/`).
- Pull step-level timings for `api-ci`, `e2e-prepare`, `e2e-app`,
  `maestro-e2e`, and `example-backend-docker`. Record how much of each is
  checkout, `bun install`, dependency compile, lint, typecheck, and tests.

### e2e chain (`e2e-prepare` 5.4 min → `e2e-app` 4.0 min)

- **Cache the Expo web export**, keyed on a hash of the inputs it reads
  (`example-frontend`, the workspace packages it bundles, `bun.lock`). On a
  hit, `e2e-prepare` skips `bun expo export`. The e2e affected gate already
  computes the reachable input set (`scripts/ci/e2eAffected`), so reuse it for
  the cache key.
- Build `e2e-prepare` in parallel with lint and compile, not after them, and
  start shards as soon as their artifact exists.
- Rebalance or split `e2e-app`, the slowest shard, using Playwright timing
  data. Static splitting is free with `circleci testsuite`.

### `api-ci` (10.8 min)

- Split lint, typecheck, and tests into parallel jobs. The test step alone is
  about 4 min locally.
- Static test splitting across `parallelism: 2–3` nodes. This needs the
  coverage-splice work below, so each node's LCOV can combine into one exact
  report.
- Make every test file pass alone. 10 `api` files fail today, mostly 5 s
  `beforeAll` timeouts. Splitting and TIA both need this.
- **Test impact analysis**, piloted as described in
  [Appendix A](#appendix-a--smarter-testing-findings). The simulation selects
  about 46% of `api` test time on a typical PR.

### Every job

- Cache the `bun install` store. All jobs install without a cache today.
- Cache workspace `dist/` output from `compile_packages`, keyed by each
  package's source hash.
- Right-size resource classes for jobs on the critical path. `large` costs
  2× `medium` credits per minute but can halve CPU-bound steps. Check against
  guardrail 5.
- Shorten the setup workflow: path filtering plus continuation takes about
  0.6–1.0 min.

### `maestro-e2e` (8.9 min), `example-backend-docker` (7.6 min), `admin-spa-integration` (6.0 min)

- Reuse the Expo export cache from the e2e chain in `maestro-e2e` and
  `admin-spa-integration`.
- Tighten path filters. Check these run only when their inputs change.
- `example-backend-docker`: make better use of layer cache through BuildKit
  `--cache-from` on a registry image. Docker Layer Caching costs 200 credits
  per job, so compare costs first.

## Appendix A — Smarter Testing findings

Source docs:
[get started](https://circleci.com/docs/guides/test/getting-started-with-smarter-testing/),
[test impact analysis](https://circleci.com/docs/guides/test/set-up-test-impact-analysis/),
[`test-suites.yml` reference](https://circleci.com/docs/reference/testsuite-configuration-reference/),
[overview and credit charge](https://circleci.com/docs/guides/test/smarter-testing-overview/).

**How it works.** `.circleci/test-suites.yml` defines suites with `discover`
(lists test atoms, here files) and `run` (gets `<< test.atoms >>` and writes
`<< outputs.junit >>`). An optional `analysis` command is the run command with
coverage, writing `<< outputs.lcov >>` one atom at a time. The job step becomes
`circleci testsuite run "<suite>"`, run from the package root.

- **Analysis** runs on `master` and records which files each atom covers.
- **Selection** runs on PRs. It runs new atoms, atoms that failed last time,
  and atoms whose covered files changed. `full-test-run-paths` and
  `test-selection-rules` cover what coverage cannot see.
- **Free:** `testsuite run`, static splitting, rerun-only-failed, and test
  uploads.
- **Charged:** TIA, dynamic splitting, dynamic parallelism, and auto-rerun, at
  3,000 credits per 100k atoms above the plan allowance. Estimated $1–3 a month
  for us.

**Bun compatibility (verified locally).**
`bun test --reporter=junit --reporter-outfile=…` writes JUnit, and
`bun test --coverage --coverage-reporter=lcov --coverage-dir=<dir> <atom>`
writes a usable LCOV. Bun writes to a directory, so `analysis` needs a wrapper
that moves `lcov.info` to `<< outputs.lcov >>`.

**Selection simulation.** I ran each `api` and `ui` test file alone with
coverage, then replayed the last 60 PR merges per package (version bumps
excluded):

| | `api` | `ui` |
|---|---|---|
| Atoms | 149 | 201 |
| Full suite, local | 3 m 49 s | 1 m 14 s |
| Analysis, one atom at a time | 17 min serial | 55 s at 4-way |
| Atoms failing when run alone | 10 | 1 |
| PRs forced to a full run | 19 / 60 | 14 / 60 |
| Mean / median share of test time selected | 46% / 39% | 43% / 43% |

Hub files limit the savings. In `api`, `logger.ts` and `requestContext.ts`
are covered by 149/149 atoms and `errors.ts` by 131. Coverage also cannot see
across packages: every `bunfig.toml` ignores `../**` and dependencies resolve
to `dist/`. Each downstream suite therefore needs `full-test-run-paths` for
its upstream packages. Whether paths outside the CLI's working directory are
allowed must be checked with `circleci testsuite doctor`.

**Coverage splicing (keeps gates blocking and exact).** The PR job builds a
whole-package LCOV, then runs the unchanged 95% gate, the 90% new-file gate,
and the Codecov upload on it.

- **Changed files** (vs merge base) come from the PR's selected run. All atoms
  covering them run in one `bun test` process, so those files are exact.
- **Unchanged files** come from `master`'s full-run LCOV at the merge base,
  using the per-file maximum with the PR run.
- **Wiring:** `master` saves `coverage/lcov.info` via `save_cache`, keyed
  `cov-base-<pkg>-{{ checksum "base-sha.txt" }}`. The PR job writes the merge
  base to `base-sha.txt` and restores that key.
- **Fallback:** if there is no baseline, or a full-run path changed, run the
  full coverage suite as today.

Why per-file and not per-atom: Bun reports a different set of instrumented
lines per process, and writes only `FNF`/`FNH` totals, not which functions
ran. Merging the 149 per-atom `api` reports gave 95.24% functions vs 98.95%
real.

Validated on `ui`: baseline at `7fc9843c^`, PR at HEAD, 9 changed files,
16/201 atoms selected (7.9 s vs 74 s). The spliced report matched the full run
exactly: 211/211 files, lines 99.25% = 99.25%, functions 98.61% = 98.61%.

Known gap: an unchanged file can lose coverage when a changed file stops
calling it. The `master` full run catches this right after merge and must
comment on the PR.

**TIA pilot steps (when the loop picks this lever).**
1. Add the suite with `test-impact-analysis: true`,
   `test-analysis-duration: 20`, and `full-test-run-paths`. Run analysis as a
   non-blocking `master` job.
2. Shadow it on PRs for 2 weeks. `list-tests` records what would be selected,
   while the full suite still runs. Compare spliced LCOV against full LCOV,
   file by file.
3. Make it blocking only with zero selection misses, zero splice mismatches,
   and a median test-step saving of at least 40%.
