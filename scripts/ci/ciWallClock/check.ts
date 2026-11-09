#!/usr/bin/env bun
/**
 * Reports CircleCI wall clock for recently merged PRs: the metric for
 * docs/implementationPlans/circleci-pr-speed-loop.md.
 *
 * Usage:
 *   bun run ci:wall-clock                                  # last 60 merged PRs
 *   bun run ci:wall-clock --limit 20 --max-directories 3
 *   bun run ci:wall-clock --json
 *
 * Needs an authenticated `gh`. See docs/how-to/circleci.md#measure-pr-ci-speed.
 */
import {join} from "node:path";

import {githubPullRequestSource} from "./github";
import {collectWallClockRows, summarizeWallClock} from "./lib";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const readFlag = ({fallback, min, name}: {fallback: number; min: number; name: string}): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < min) {
    console.error(`--${name} must be an integer >= ${min}`);
    process.exit(2);
  }
  return value;
};

const limit = readFlag({fallback: 60, min: 1, name: "limit"});
const maxDirectories = readFlag({fallback: 3, min: 0, name: "max-directories"});
const rows = await collectWallClockRows({limit, source: githubPullRequestSource({cwd: REPO_ROOT})});
const summary = summarizeWallClock({maxDirectories, rows});

if (process.argv.includes("--json")) {
  console.info(JSON.stringify({maxDirectories, rows, summary}, null, 2));
  process.exit(0);
}

const line = (label: string, {count, median, p25, p75}: typeof summary.all): string =>
  `${label.padEnd(34)} n=${String(count).padEnd(4)} median=${median.toFixed(1)}m  p25=${p25.toFixed(1)}m  p75=${p75.toFixed(1)}m`;

console.info(line(`Average PRs (<= ${maxDirectories} directories)`, summary.average));
console.info(line("All PRs", summary.all));
console.info("\nJob that finished last on average PRs:");
for (const {count, job} of summary.lastJobOnAverage) {
  console.info(`  ${job.padEnd(32)} ${count}`);
}
