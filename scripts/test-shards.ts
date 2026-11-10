#!/usr/bin/env bun
/**
 * Runs `bun test` in the working directory as concurrent `--shard` processes.
 *
 * Usage (from a package directory):
 *   bun ../scripts/test-shards.ts                       # every test file
 *   bun ../scripts/test-shards.ts -- --only-failures src/
 *   bun ../scripts/test-shards.ts --isolated -- --preload ./src/tests/bunSetup.ts
 *   TERRENO_TEST_SHARDS=1 bun ../scripts/test-shards.ts  # one unsplit process
 *
 * Arguments after `--` go to every `bun test` process. `--isolated` then runs each
 * `src/isolated/*.isolated.ts(x)` file in a process of its own, with the same arguments.
 * The exit code is 1 when any process fails.
 *
 * Docs: docs/explanation/test-sharding.md
 */
import {availableParallelism} from "node:os";

import {
  findIsolatedFiles,
  formatShardSummary,
  parseRunnerArgs,
  resolveShardCount,
  runIsolatedFiles,
  runShards,
} from "./ci/testShards/lib";

const main = async (): Promise<void> => {
  const parsed = parseRunnerArgs({argv: process.argv.slice(2)});
  const {error, total} = resolveShardCount({cpuCount: availableParallelism(), env: process.env});
  const usageError = parsed.error ?? error;
  if (usageError) {
    console.error(usageError);
    process.exit(2);
  }
  const {bunArgs, isIsolatedIncluded} = parsed;

  const {results} = await runShards({
    argsForShard: () => bunArgs,
    cwd: process.cwd(),
    env: process.env,
    total,
  });
  if (total > 1) {
    console.info(`\n${formatShardSummary({results}).text}`);
  }
  if (!results.every((result) => result.exitCode === 0)) {
    process.exit(1);
  }

  if (isIsolatedIncluded) {
    const isolated = await runIsolatedFiles({
      bunArgs,
      cwd: process.cwd(),
      env: process.env,
      files: findIsolatedFiles(process.cwd()),
      limit: total,
    });
    const failed = isolated.results.filter((result) => result.exitCode !== 0);
    if (failed.length > 0) {
      console.error(`\nIsolated file(s) failed: ${failed.map((result) => result.file).join(", ")}`);
      process.exit(1);
    }
  }
  process.exit(0);
};

void main();
