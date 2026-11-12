# Test sharding in Bun suites

Every package runs its tests through `scripts/test-shards.ts`. The runner starts several
`bun test --shard=<i>/<n>` processes at once, one per shard, and fails when any of them
fails. Bun 1.4.4 or newer is required: older versions have no `--shard`.

```bash
cd api
bun run test:ci                          # shards chosen from the machine's cores
TERRENO_TEST_SHARDS=1 bun run test:ci    # one unsplit process
TERRENO_TEST_SHARDS=3 bun run test:ci    # exactly three shards
bun test ./src/auth.test.ts              # one file, no runner
```

## Why shards and not `bun test --parallel`

A shard is an ordinary `bun test` process. It loads the preload once, keeps one module
registry, and starts one in-memory Mongo, exactly as an unsplit run does. A test file sees
the same world either way. Only the set of files that share its process changes.

`bun test --parallel` gives each file a fresh global. That re-runs the preload's
`beforeAll` and `afterAll` for every file, so a backend package starts and stops Mongo once
per file and reloads every module. Measured on `@terreno/api` (169 files, 4 cores): 648 s
unsplit, 459 s with `--parallel`, 408 s with two shards.

## How many shards

| Source | Shards |
| --- | --- |
| `TERRENO_TEST_SHARDS` set | That number |
| Not set | Half the cores, at least 1, at most 4 |

A backend shard keeps a Bun process and a `mongod` busy, about two cores. More shards than
half the cores slows every shard down and makes timing-sensitive tests fail.

CircleCI jobs set `TERRENO_TEST_SHARDS` themselves, because a container reports the host's
cores and not its own CPU limit. Medium jobs (2 vCPU) run 1 shard. Backend jobs run 1 shard
even on `large`: CircleCI gives a job one sidecar `mongod`, and every shard connects to the
same `mongodb://127.0.0.1/terreno` database, so concurrent shards clear each other's
collections mid-test. `api-ci` ran 2 shards until that broke its tests.

Root `bun run test` and `bun run test:agent` set `TERRENO_TEST_SHARDS=1`: they already run
every package at the same time.

## Measured speedup

One 4-core machine, every package's `test:ci` run one after another:

| Package | Unsplit | 2 shards |
| --- | --- | --- |
| `api` | 648 s | 408 s |
| `ai` | 314 s | 187 s |
| `example-backend` | 253 s | 135 s |
| `admin-frontend` | 142 s | 75 s |
| `admin-backend` | 124 s | 83 s |
| `ui` | 95 s | 65 s |
| All 21 packages | 1849 s | 1163 s |

Packages that finish in a few seconds gain nothing and lose nothing.

## Isolated files

`ai` and `admin-frontend` pass `--isolated` to the runner. After the shards pass, each
`src/isolated/*.isolated.ts(x)` file runs in a process of its own, as many at a time as there
are shards. See [Test isolation](test-isolation.md).

## Coverage

`bun run test:coverage` (`scripts/check-coverage.ts`) uses the same shards. Each shard writes
its own LCOV report. The script merges them, writes `coverage/lcov.info`, and gates the
merged numbers at 95%.

Line coverage merges exactly: a line counts when any shard ran it. The sharded line figure
equals the unsplit one.

Function coverage cannot merge exactly. Bun's LCOV has no per-function records, only a found
and hit count per file, and Bun counts a nested function only after its parent ran, so shards
disagree on how many functions a file has. The script takes the largest found count and the
largest hit count for each file. That estimate usually reads low, because functions hit in
different shards are not added together. It can read high when one shard runs most of a file
and another shard finds nested functions that nothing calls.

A sharded run that misses 95% is run again as one unsplit process, and the gate uses that
exact result. A package whose function coverage is near 95% therefore pays for a second pass;
set `TERRENO_TEST_SHARDS=1` to skip the first. CircleCI gates every package unsplit except
`api` and `ai`, which run 2 shards.

While shards run, their output is held and printed one shard at a time. The runner prints a
`[shards] still running` line once a minute so CI does not see a silent job.

## When a test fails only in a shard

Sharding changes which files share a process. A test that passed only because an earlier
file left something behind now fails. Run the file alone to confirm:

```bash
bun test ./src/models/configuration.test.ts
```

Fix the file so it passes alone. The usual causes:

1. **A missing import.** The test reads state that another file's import registered. Import
   the module in the test.
2. **A module mock from another file.** A snapshot or assertion matches another file's
   `mock.module` shape. Register the mock once in the package preload.
3. **A timing budget.** Shards load the machine. Freeze the clock with `setSystemTime` or give
   a slow test its own timeout; do not rely on wall-clock windows.

To reproduce the exact process a shard ran, pass the shard to Bun directly:

```bash
bun test --shard=2/3
```
