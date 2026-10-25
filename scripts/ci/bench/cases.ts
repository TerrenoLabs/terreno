import type {BenchCase} from "./lib";

/**
 * Benchmark set for the CircleCI PR speed loop. Recent average PRs (3 or fewer top-level
 * directories). Refresh every 10 iterations, or sooner when a case replays as `invalid`.
 */
export const BENCH_CASES: BenchCase[] = [
  {name: "api-only", pullRequest: 1596},
  {name: "ui-only", pullRequest: 1612},
  {name: "syncdb-only", pullRequest: 1615},
  {name: "api-example", pullRequest: 1592},
  {name: "small-package", pullRequest: 1620},
];
