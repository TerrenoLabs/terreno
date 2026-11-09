#!/usr/bin/env bun
/**
 * Runs the local mirror of every CI job a branch would trigger.
 *
 * Every step runs even after a failure so one pass reports every problem; fix
 * them all, then push once. Exit code is non-zero when any step failed.
 *
 * Usage:
 *   bun run prepush                  # affected checks vs merge-base with origin/master
 *   bun run prepush --dry-run        # print the plan only
 *   bun run prepush --all            # every check regardless of changed files
 *   bun run prepush --base <ref>     # compare against another base ref
 *
 * Policy: docs/how-to/run-tests-locally.md
 */
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {DateTime} from "luxon";

import {readMappings} from "../../check-circleci-parity/lib";
import {changedFilesSince, resolveMergeBase} from "../e2eAffected/git";
import {type PrepushPlan, type PrepushStep, planPrepush} from "./plan";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

interface Options {
  all: boolean;
  base: string;
  isDryRun: boolean;
}

export const parseArguments = (argv: string[]): Options => {
  const options: Options = {all: false, base: "origin/master", isDryRun: false};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--all") {
      options.all = true;
    } else if (flag === "--dry-run") {
      options.isDryRun = true;
    } else if (flag === "--base" && argv[index + 1]) {
      options.base = argv[index + 1];
      index += 1;
    }
  }
  return options;
};

const gitLines = (args: string[]): string[] => {
  const result = spawnSync("git", args, {cwd: REPO_ROOT, encoding: "utf8"});
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

/** Committed branch changes plus staged, unstaged, and untracked files. */
const collectChangedFiles = ({baseSha}: {baseSha: string}): string[] => {
  const committed = changedFilesSince({baseSha, repoRoot: REPO_ROOT}) ?? [];
  const working = gitLines(["diff", "--name-only", "HEAD"]);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...committed, ...working, ...untracked])].sort();
};

const printCiOnly = (ciOnly: PrepushPlan["ciOnly"]): void => {
  if (ciOnly.length === 0) {
    return;
  }
  console.info("\nCI-only jobs this change triggers (run by hand when the change touches them):");
  for (const item of ciOnly) {
    console.info(`  ${item.parameter}: ${item.hint}`);
  }
};

const runStep = (step: PrepushStep): {isOk: boolean; seconds: number} => {
  const started = DateTime.now();
  console.info(`\n=== ${step.name}${step.cwd ? ` (${step.cwd})` : ""}\n$ ${step.command}`);
  const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.command], {
    cwd: join(REPO_ROOT, step.cwd ?? "."),
    env: {...process.env, CI: "true"},
    // A closed parent stdin (agent shells, background runs) makes nested
    // posix_spawn calls fail with EBADF, so give every step /dev/null instead.
    stdio: ["ignore", "inherit", "inherit"],
  });
  const seconds = Math.round(DateTime.now().diff(started, "seconds").seconds);
  if (result.error) {
    console.error(`prepush: could not start step: ${result.error.message}`);
  }
  return {isOk: result.status === 0, seconds};
};

const main = (): void => {
  const options = parseArguments(process.argv.slice(2));
  // CI diffs against fresh master; a stale origin/master drags master's own files
  // into the changed set. Offline, fall back to the cached ref.
  const [remote, ...branch] = options.base.split("/");
  if (branch.length > 0) {
    spawnSync("git", ["fetch", "--quiet", remote, branch.join("/")], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  }
  const baseSha = resolveMergeBase({baseRef: options.base, repoRoot: REPO_ROOT});
  if (!baseSha) {
    console.error(
      `prepush: cannot resolve merge-base with ${options.base}. Run: git fetch origin master`
    );
    process.exit(1);
  }

  const changedFiles = collectChangedFiles({baseSha});
  const plan = planPrepush({
    all: options.all,
    baseSha,
    changedFiles,
    mappings: readMappings({repoRoot: REPO_ROOT}),
  });

  console.info(`prepush: ${changedFiles.length} changed files since ${baseSha.slice(0, 8)}`);
  console.info(`prepush: CI jobs triggered: ${plan.parameters.join(", ") || "none"}`);
  console.info(`prepush: ${plan.steps.length} local steps`);
  for (const step of plan.steps) {
    console.info(`  - ${step.name}`);
  }

  if (options.isDryRun) {
    printCiOnly(plan.ciOnly);
    return;
  }

  const results = plan.steps.map((step) => ({step, ...runStep(step)}));
  const failed = results.filter((result) => !result.isOk);

  console.info("\n=== prepush summary");
  for (const result of results) {
    console.info(
      `${result.isOk ? "PASS" : "FAIL"} ${String(result.seconds).padStart(4)}s  ${result.step.name}`
    );
  }
  printCiOnly(plan.ciOnly);
  if (failed.length > 0) {
    console.error(
      `\nprepush: ${failed.length} of ${results.length} steps failed. Fix all of them, then push once.`
    );
    process.exit(1);
  }
  console.info(`\nprepush: all ${results.length} steps passed.`);
};

if (import.meta.main) {
  main();
}
