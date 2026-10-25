#!/usr/bin/env bun
/**
 * Replays the benchmark set against a branch under test and against master, then reports
 * the CircleCI wall-clock change. Opens and closes draft PRs labelled `ci-bench`.
 *
 * Usage:
 *   bun run ci:bench --branch ci-speed/1-cache --label iter1
 *   bun run ci:bench --branch origin/master --label baseline --cases api-only,ui-only --runs 1
 *   bun run ci:bench --suggest-cases            # replayable recent average PRs for cases.ts
 *
 * Results append to .terreno/ci-bench/<label>.jsonl. See
 * docs/how-to/circleci.md#benchmark-a-ci-change.
 */
import {execFileSync} from "node:child_process";
import {appendFileSync, mkdirSync} from "node:fs";
import {join} from "node:path";

import {githubPullRequestSource} from "../ciWallClock/github";
import {BENCH_CASES} from "./cases";
import {githubBenchAdapter} from "./github";
import {type BenchResult, MASTER_REF, runBenchCase, suggestBenchCases, summarizeBench} from "./lib";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const MINUTE = 60_000;

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

if (process.argv.includes("--suggest-cases")) {
  execFileSync("git", ["fetch", "--quiet", "origin", "master"], {cwd: REPO_ROOT});
  const suggestions = await suggestBenchCases({
    adapter: githubBenchAdapter({repoRoot: REPO_ROOT}),
    limit: 10,
    maxDirectories: 3,
    pullRequests: await githubPullRequestSource({cwd: REPO_ROOT}).listMergedPullRequests(200),
  });
  console.info("Replayable recent average PRs (newest first):");
  for (const {directories, pullRequest} of suggestions) {
    console.info(`  #${pullRequest}  ${directories.join(", ")}`);
  }
  process.exit(0);
}

const branch = readOption("branch");
const label = readOption("label");
if (!branch || !label || !/^[a-z0-9-]+$/.test(label)) {
  console.error(
    "Usage: bun run ci:bench --branch <ref> --label <kebab-case> [--cases a,b] [--runs 2]"
  );
  process.exit(2);
}
const runs = Number(readOption("runs") ?? "2");
const caseNames = readOption("cases")?.split(",");
const cases = caseNames
  ? BENCH_CASES.filter((benchCase) => caseNames.includes(benchCase.name))
  : BENCH_CASES;
if (!Number.isInteger(runs) || runs < 1 || cases.length === 0) {
  console.error(
    `--runs must be >= 1 and --cases must name at least one of: ${BENCH_CASES.map((c) => c.name).join(", ")}`
  );
  process.exit(2);
}

// A branch behind master runs an older job set, so its timings would not be comparable.
execFileSync("git", ["fetch", "--quiet", "origin", "master"], {cwd: REPO_ROOT});
if (branch !== MASTER_REF) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", MASTER_REF, branch], {cwd: REPO_ROOT});
  } catch {
    console.error(`${branch} does not contain ${MASTER_REF}. Merge master into it, then rerun.`);
    process.exit(2);
  }
}

const outputDirectory = join(REPO_ROOT, ".terreno", "ci-bench");
mkdirSync(outputDirectory, {recursive: true});
const outputFile = join(outputDirectory, `${label}.jsonl`);
const adapter = githubBenchAdapter({repoRoot: REPO_ROOT});

// Cases run one after another; within a case the control and treatment run together.
const results: BenchResult[] = [];
for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
  for (const benchCase of cases) {
    let caseResults: BenchResult[];
    try {
      caseResults = await runBenchCase({
        adapter,
        benchCase,
        branch,
        label,
        pollMs: MINUTE,
        quietMs: 3 * MINUTE,
        runIndex,
        timeoutMs: 60 * MINUTE,
      });
    } catch (error) {
      caseResults = [
        {
          case: benchCase.name,
          reason: String(error),
          role: "control",
          run: runIndex,
          status: "error",
        },
      ];
    }
    for (const result of caseResults) {
      appendFileSync(outputFile, `${JSON.stringify({branch, label, ...result})}\n`);
      console.info(
        `${result.case} run ${result.run} ${result.role}: ${result.status}` +
          (result.minutes === undefined ? "" : ` ${result.minutes}m (last: ${result.lastJob})`) +
          (result.reason ? ` — ${result.reason}` : "")
      );
    }
    results.push(...caseResults);
  }
}

const summary = summarizeBench(results);
console.info(`\nControl (master) median: ${summary.control}m`);
console.info(`Treatment (${branch}) median: ${summary.treatment}m`);
console.info(`Change: ${summary.changePercent}%   Runs not counted: ${summary.invalid}`);
console.info(`Results: ${outputFile}`);
