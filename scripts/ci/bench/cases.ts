import type {BenchCase} from "./lib";

/**
 * Benchmark set for the CircleCI PR speed loop: recent average PRs (3 or fewer top-level
 * directories) whose code still reverts cleanly on master, covering the jobs that most often
 * finish last. Refresh with `bun run ci:bench --suggest-cases` every 10 iterations, or sooner
 * when a case replays as `invalid` or no longer reverts.
 */
export const BENCH_CASES: BenchCase[] = [
  {name: "api-only", pullRequest: 1491},
  {name: "api-syncdb", pullRequest: 1555},
  {name: "ui-only", pullRequest: 1567},
  {name: "admin-example", pullRequest: 1540},
  {name: "small-package", pullRequest: 1599},
];
