#!/usr/bin/env bun
/**
 * Fails when the branch adds `mock.module` to a shared Bun test suite.
 *
 * Usage:
 *   bun run check:test-isolation                # vs merge-base with origin/master
 *   bun run check:test-isolation --base <ref>
 *
 * Policy: docs/explanation/test-isolation.md
 */
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {resolveMergeBase} from "../e2eAffected/git";
import {
  addedLinesForNewFile,
  addedLinesFromDiff,
  findIsolationViolations,
  formatIsolationReport,
  isSharedSuiteTestFile,
} from "./lib";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const git = (args: string[]): string =>
  execFileSync("git", args, {cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});

const readFile = (path: string): string | undefined => {
  const absolute = join(REPO_ROOT, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
};

const main = (): void => {
  const baseIndex = process.argv.indexOf("--base");
  const baseRef = baseIndex >= 0 ? process.argv[baseIndex + 1] : "origin/master";
  const baseSha = resolveMergeBase({baseRef, repoRoot: REPO_ROOT});
  if (!baseSha) {
    console.error(
      `check-test-isolation: cannot resolve merge-base with ${baseRef}. Run: git fetch origin master`
    );
    process.exit(1);
  }

  // Diff the base against the working tree so uncommitted edits count too.
  const addedLines = addedLinesFromDiff(
    // Pin prefixes and disable external diff tools so user git config cannot change the format.
    git([
      "diff",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      baseSha,
      "--",
      "*.test.ts",
      "*.test.tsx",
      "*.spec.ts",
      "*.spec.tsx",
    ])
  );
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter((path) => path.length > 0 && isSharedSuiteTestFile(path));
  for (const path of untracked) {
    addedLines.set(path, addedLinesForNewFile(readFile(path) ?? ""));
  }

  const violations = findIsolationViolations({addedLines, fileContents: readFile});
  if (violations.length > 0) {
    console.error(formatIsolationReport(violations));
    process.exit(1);
  }
  console.info("check-test-isolation: OK (no new mock.module calls in shared suites)");
};

main();
